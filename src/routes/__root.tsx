import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import appCss from '../styles.css?url'
import '../styles.css' // Direct import for Vite processing
import type { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import Navbar from '#/components/navbar'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  component: RootLayout,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootLayout(){
  return (
    <div className='min-h-svh'>
      <Navbar/>
      <Outlet/>
    </div>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className='font-sans antialiased bg-background text-foreground selection:bg-primary/20'>
        
        {children}
        <Toaster/>
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <main className="min-h-[80vh] pt-24 pb-12 px-4 flex flex-col items-center justify-center text-center">
      <div className="max-w-md mx-auto space-y-6 glass p-8 rounded-2xl border border-border/50">
        <h1 className="text-8xl font-black tracking-tight text-primary animate-pulse">404</h1>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">Page Not Found</h2>
          <p className="text-muted-foreground text-sm">
            The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-6 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Go to Homepage
          </Link>
        </div>
      </div>
    </main>
  )
}
