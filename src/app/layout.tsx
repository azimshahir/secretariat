import type { Metadata } from "next"
import { Suspense } from "react"
import { Inter, Space_Grotesk } from "next/font/google"
import { NavigationTransitionProvider } from "@/components/navigation-transition-provider"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import "./globals.css"

const bodyFont = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const displayFont = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "secretariat.my",
  description: "Agentic board meeting minute automation for enterprise banks",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${bodyFont.variable} ${displayFont.variable} antialiased`}
      >
        <NavigationTransitionProvider>
          <Suspense fallback={<TooltipProvider>{children}</TooltipProvider>}>
            <TooltipProvider>{children}</TooltipProvider>
          </Suspense>
        </NavigationTransitionProvider>
        <Toaster />
      </body>
    </html>
  )
}
