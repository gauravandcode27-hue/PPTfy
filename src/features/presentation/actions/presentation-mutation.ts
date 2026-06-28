import { createServerFn } from "@tanstack/react-start";
import { createPresentationInputSchema, presentationIdInputSchema, updatePresentationInputSchema } from "../types/schema";
import { authFnMiddleware } from "#/middleware/auth";
import { prisma } from "#/lib/db";
import { generateSlug } from "random-word-slugs"
import { PresentationStatus } from "#/generated/prisma/enums";
import { inngest } from "#/integrations/tanstack-query/inngest/client";
import { generatePresentationContentInline } from "#/integrations/tanstack-query/inngest/function";

async function triggerPresentationGeneration(presentationId: string) {
    try {
        await inngest.send({
            name: "presentation/generate",
            data: { presentationId }
        });
    } catch (error) {
        console.warn(`Inngest dispatch failed for presentation ${presentationId}, falling back to inline generation:`, error);
        // Fire-and-forget promise to generate slides in the background
        generatePresentationContentInline(presentationId).catch((err) => {
            console.error(`Failed during inline slide generation fallback for presentation ${presentationId}:`, err);
        });
    }
}

export const createPresentation = createServerFn({ method: "POST" })
    .validator((data: unknown) => createPresentationInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id
        
        const presentation = await prisma.presentation.create({
            data: {
                userId,
                title: generateSlug(),
                prompt: data.prompt,
                slideCount: data.slideCount,
                style: data.style,
                tone: data.tone,
                layout: data.layout,
                status: PresentationStatus.GENERATING,
            },
        })

        await triggerPresentationGeneration(presentation.id);

        return presentation;
    })

export const getPresentation = createServerFn({ method: "GET" })
    .validator((data: unknown) => presentationIdInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id

        const presentation = await prisma.presentation.findFirst({
            where: { id: data.id, userId },
            include: {
                slides: {
                    orderBy: { order: 'asc' },
                },
            },
        })

        if (!presentation) throw new Error('Not Found')

        return presentation
    })


export const updatePresentation = createServerFn({ method: "POST" })
    .validator((data: unknown) => updatePresentationInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id

        const { id, ...patch } = data;
        const exiting = await prisma.presentation.findFirst({
            where: { id, userId }
        });

        if (!exiting) throw new Error('Not Found');

        const updateData = patch;

        return prisma.presentation.update({
            where: { id },
            data: updateData,
        })
    });

export const deletePresentation = createServerFn({ method: 'POST' })
    .validator((data: unknown) => presentationIdInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id

        const exiting = await prisma.presentation.findFirst({
            where: { id: data?.id, userId }
        });

        if (!exiting) throw new Error('Not Found');

        await prisma.presentation.delete({
            where: {
                id: data.id
            }
        })

        return {
            ok: true as const,
        }
    })

export const regeneratePresentation = createServerFn({ method: "POST" })
    .validator((data: unknown) => presentationIdInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id

        const exiting = await prisma.presentation.findFirst({
            where: { id: data?.id, userId }
        });

        if (!exiting) throw new Error('Not Found');

        await prisma.presentation.update({
            where: { id: data.id },
            data: {
                status: PresentationStatus.GENERATING
            },
        });

        await triggerPresentationGeneration(data.id);

        return { ok: true as const }
    })
