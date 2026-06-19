import { createServerFn } from "@tanstack/react-start";
import { createPresentationInputSchema, presentationIdInputSchema, updatePresentationInputSchema } from "../types/schema";
import { authFnMiddleware } from "#/middleware/auth";
import { prisma } from "#/lib/db";
import { generateSlug } from "random-word-slugs"
import { PresentationStatus } from "#/generated/prisma/enums";




export const createPresentation = createServerFn({ method: "POST" })
    .validator((data: unknown) => createPresentationInputSchema.parse(data))
    .middleware([authFnMiddleware])
    .handler(async ({ data, context }) => {
        const userId = context?.session?.user?.id

        const presentation = await prisma.presentation.create(
          {  data, 
            userId,
            title: generateSlug(),
            prompt: data.prompt,
            slideCount: data.prompt,
            style: data.style,
            tone: data.tone,
            layout: data.layout,
            status: PresentationStatus.COMPLETED,
        },
        );

        //todo: inngest background job

        return presentation;
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
        return { ok: true as const }
    })