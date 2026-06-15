"use client"

import { createFileRoute } from '@tanstack/react-router'
import { Switch } from '#/components/ui/switch'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8 flex items-center gap-4">
      
      <Switch />
    </div>
  )
}
