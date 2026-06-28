import { inngest } from "./client";
import { prisma } from "#/lib/db";
import { z } from "zod";
import { Output, generateText } from "ai";
import { createGoogle } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createXai } from "@ai-sdk/xai";
import { PresentationStatus } from "#/generated/prisma/enums";

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
  try {
    const presentation = await prisma.presentation.findUnique({
      where: { id: presentationId }
    });
    if (!presentation) throw new Error("Presentation not found");

    await prisma.presentation.update({
      where: { id: presentationId },
      data: { status: PresentationStatus.GENERATING }
    });

    const model = getAIModel();
    await performSlideGeneration({ presentation, model });

    await prisma.presentation.update({
      where: { id: presentationId },
      data: { status: PresentationStatus.COMPLETED }
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to generate presentation in-process:", error);
    await prisma.presentation.update({
      where: { id: presentationId },
      data: { status: PresentationStatus.FAILED }
    });
    throw error;
  }
}

export const generatePresentation = inngest.createFunction({
  id: "generate-presentation",
  retries: 2,
  triggers: [{ event: "presentation/generate" }]
},
  async ({ event, step }) => {
    const { presentationId } = event.data as { presentationId: string }

    const presentation = await step.run("fetch-presentation", async () => {
      const p = await prisma?.presentation.findUnique({
        where: { id: presentationId }
      });
      if (!p) throw new Error("Presentation not found");
      return p;
    });

    await step.run("mark-generating", async () => {
      await prisma?.presentation.update({
        where: { id: presentation.id },
        data: { status: PresentationStatus.GENERATING }
      });
    });

    await step.run("generate-slides-content", async () => {
      const model = getAIModel();
      await performSlideGeneration({ presentation, model });
    });

    await step.run("mark-completed", async () => {
      await prisma.presentation.update({
        where: { id: presentationId },
        data: { status: PresentationStatus.COMPLETED },
      });
    });

    return { success: true };
  }
)