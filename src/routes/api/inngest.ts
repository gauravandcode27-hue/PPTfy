import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";
import { inngest } from "#/integrations/tanstack-query/inngest/client";
import { generatePresentation } from "#/integrations/tanstack-query/inngest/function";

const handler = serve({
  client: inngest,
  functions: [
   generatePresentation
  ],
  servePath: "/api/inngest",
});

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return await handler(request);
      },
      POST: async ({ request }) => {
        return await handler(request);
      },
      PUT: async ({ request }) => {
        return await handler(request);
      },
    },
  },
});