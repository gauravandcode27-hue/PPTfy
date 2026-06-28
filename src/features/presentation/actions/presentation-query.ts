import { createServerFn } from "@tanstack/react-start";
import { presentationIdInputSchema } from "../types/schema";
import { authMiddleware } from "#/middleware/auth";
import { prisma } from "#/lib/db";

export const getPresentationWithSlides = createServerFn({method:"GET"})
.validator((data:unknown)=>presentationIdInputSchema.parse(data))
.middleware([authMiddleware])
.handler(async({data, context})=>{
    const userId = context?.session?.user?.id
    
    const row = await prisma.presentation.findFirst({
        where: {
            id: data.id,
            userId,
        },
        include: {
            slides:{
               orderBy: { order: 'asc'} 
            }
        }
    })
    return row;
})

export const listPresentations = createServerFn({method:"GET"})
.middleware([authMiddleware])
.handler(async({data, context})=>{
    const userId = context?.session?.user?.id

    return prisma.presentation.findMany({
        where: {userId},
        orderBy:{updatedAt:"desc"}
    })
})