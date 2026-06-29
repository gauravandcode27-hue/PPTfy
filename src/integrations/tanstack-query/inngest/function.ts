import { inngest } from "./client";
import { prisma } from "#/lib/db";
import { z } from "zod";
import { Output, generateText } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createXai } from "@ai-sdk/xai";
import { eventType, NonRetriableError } from "inngest";
import { PresentationStatus } from "#/generated/prisma/enums";

// This schema is used only internally for parsing; we do NOT attach it to
// the eventType so that Inngest's SDK-level schema validation doesn't reject
// old events that used `id` instead of `presentationId`, or events replayed
// from the Inngest dashboard that may have a different shape.
const presentationGenerateDataSchema = z.object({
  presentationId: z.string().min(1),
});

export const presentationGenerateEvent = eventType("presentation/generate");

function parsePresentationId(data: unknown): string {
  const parsed = presentationGenerateDataSchema.safeParse(data);
  if (parsed.success) {
    return parsed.data.presentationId;
  }

  // Backwards compatibility if an event was sent with `id` instead.
  if (data && typeof data === "object" && "id" in data) {
    const id = (data as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) {
      return id.trim();
    }
  }

  throw new NonRetriableError(
    "presentation/generate event requires a non-empty presentationId",
  );
}

const slideSchema = z
  .object({
    title: z.string().describe('Slide title'),
    content: z
      .string()
      .optional()
      .describe('Main body text or bullet points (use • for lists). Required for every slide.'),
    subtitle: z
      .string()
      .optional()
      .describe('Do not use — put subtitle text in content instead'),
    bulletPoints: z
      .array(z.string())
      .optional()
      .describe('Alternative to content: list of bullet point strings'),
    notes: z.string().optional().describe('Speaker notes'),
    imagePrompt: z
      .string()
      .optional()
      .describe('A concise prompt to generate an illustration for this slide'),
  })
  .transform((slide) => {
    let content = slide.content?.trim()
    if (!content) {
      if (slide.subtitle?.trim()) {
        content = slide.subtitle.trim()
      } else if (slide.bulletPoints?.length) {
        content = slide.bulletPoints.map((bp) => `• ${bp}`).join('\n')
      }
    }
    if (!content) {
      content = slide.title
    }

    const imagePrompt =
      slide.imagePrompt?.trim() ||
      `Professional presentation illustration related to: ${slide.title}`

    return {
      title: slide.title,
      content,
      notes: slide.notes,
      imagePrompt,
    }
  })

function buildImageKitUrl(prompt: string, filename: string): string {
  const baseUrl = process.env.IMAGEKIT_URL!
  const sanitizedPrompt = prompt
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)

  return `${baseUrl}/ik-genimg-prompt-${encodeURIComponent(sanitizedPrompt)}/${filename}.jpg?tr=w-1280,h-720`
}

const slideResponseSchema = z.object({
  slides: z.array(slideSchema)
})

function getAIModel() {
  const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY || (googleKey?.startsWith("gsk_") ? googleKey : undefined);
  const xaiKey = process.env.XAI_API_KEY || (googleKey?.startsWith("xai-") ? googleKey : undefined);
  const geminiKey = googleKey?.startsWith("AIzaSy") ? googleKey : undefined;

  if (groqKey) {
    const groq = createGroq({ apiKey: groqKey });
    return groq("llama-3.3-70b-versatile");
  }

  if (geminiKey) {
    const google = createGoogle({ apiKey: geminiKey });
    return google("gemini-2.5-flash");
  }

  if (xaiKey) {
    const xai = createXai({ apiKey: xaiKey });
    return xai("grok-2");
  }

  if (googleKey) {
    const google = createGoogle({ apiKey: googleKey });
    return google("gemini-2.5-flash");
  }

  throw new Error("No AI API key found. Please define GOOGLE_GENERATIVE_AI_API_KEY in your .env file.");
}

// Shared slide generation core logic
export async function performSlideGeneration({
  presentation,
  model,
}: {
  presentation: any;
  model: any;
}) {
  const systemPrompt = `You are an expert presentation designer. Given a user's content/prompt, create a compelling presentation.

  Style: ${presentation.style}
  Tone: ${presentation.tone}
  Layout preference: ${presentation.layout}
  Number of slides requested: ${presentation.slideCount}

  Guidelines:
  - Create exactly ${presentation.slideCount} slides
  - First slide should be a title slide
  - Last slide should be a summary or call-to-action
  - Keep content concise and impactful
  - For imagePrompt, describe a professional illustration that complements the slide (no text in images)

  Each slide object must include:
  - title: slide heading
  - content: main body text (required on every slide — for title slides, put the subtitle line here)
  - notes: speaker notes (optional)
  - imagePrompt: illustration description

  Respond with a valid JSON object containing a "slides" array.`;

  const result = await generateText({
    model,
    output: Output.object({ schema: slideResponseSchema }),
    system: systemPrompt,
    prompt: presentation.prompt,
    providerOptions: {
      groq: {
        structuredOutputs: false,
      },
    },
  });

  const { slides } = result.output;

  await prisma.slide.deleteMany({
    where: { presentationId: presentation.id }
  });

  const data = slides.map((s, i) => ({
    presentationId: presentation.id,
    order: i,
    title: s.title,
    content: s.content,
    notes: s.notes ?? null,
    imagePrompt: s.imagePrompt,
    imageUrl: buildImageKitUrl(s.imagePrompt, `slide-${presentation.id}-${i}`),
  }));

  await prisma.slide.createMany({ data });
}

// Inline / In-process slide generation fallback
export async function generatePresentationContentInline(presentationId: string) {
  const id = presentationId?.trim();
  if (!id) {
    throw new Error("Cannot generate presentation: missing presentation ID");
  }

  try {
    const presentation = await prisma.presentation.findUnique({
      where: { id }
    });
    if (!presentation) throw new Error("Presentation not found");

    await prisma.presentation.update({
      where: { id },
      data: { status: PresentationStatus.GENERATING }
    });

    const model = getAIModel();
    await performSlideGeneration({ presentation, model });

    await prisma.presentation.update({
      where: { id },
      data: { status: PresentationStatus.COMPLETED }
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to generate presentation in-process:", error);
    await prisma.presentation.update({
      where: { id },
      data: { status: PresentationStatus.FAILED }
    }).catch(() => {});
    throw error;
  }
}

export const generatePresentation = inngest.createFunction({
  id: "generate-presentation",
  retries: 2,
  triggers: [{
    event: presentationGenerateEvent,
    if: 'event.data.presentationId != null && event.data.presentationId != ""',
  }],
},
  async ({ event, step }) => {
    const presentationId = parsePresentationId(event.data);

    const presentation = await step.run("fetch-presentation", async () => {
      const p = await prisma.presentation.findUnique({
        where: { id: presentationId },
      });
      if (!p) throw new NonRetriableError(`Presentation not found: ${presentationId}`);
      return p;
    });

    await step.run("mark-generating", async () => {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { status: PresentationStatus.GENERATING },
      });
    });

    await step.run("generate-slides-content", async () => {
      const model = getAIModel();
      await performSlideGeneration({ presentation, model });
    });

    await step.run("mark-completed", async () => {
      await prisma.presentation.update({
        where: { id: presentation.id },
        data: { status: PresentationStatus.COMPLETED },
      });
    });

    return { success: true };
  }
)