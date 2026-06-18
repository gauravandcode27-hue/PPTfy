import {
  HeadContent,
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
