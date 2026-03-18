import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
    try {
        const ip = req.headers.get("x-forwarded-for") || "unknown";

        // Initialize Supabase Client (bypassing cookies since this is an anonymous tracking route)
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll: () => [],
                    setAll: () => { },
                },
            }
        );

        // Check if IP exist in database
        const { data: existingLog } = await supabase
            .from("demo_usage_logs")
            .select("id")
            .eq("ip_address", ip)
            .single();

        if (existingLog) {
            return NextResponse.json(
                {
                    error: "LimitReached",
                    message: "You have already used your free demo. Please sign up to continue generating meeting minutes.",
                },
                { status: 429 }
            );
        }

        // Insert IP to lock them from future uses
        await supabase.from("demo_usage_logs").insert([{ ip_address: ip }]);

        // Simulate AI processing delay
        await new Promise((resolve) => setTimeout(resolve, 3500));

        // Return the mock generated content
        return NextResponse.json({
            success: true,
            data: {
                title: "Q3 Strategy Planning Sync",
                date: new Date().toISOString(),
                summary: "The team discussed the Q3 product roadmap, focusing strongly on user onboarding improvements and the rollout of the new enterprise security features. Engineering committed to delivering the SSO module by late August. Marketing will align their campaign with the launch date.",
                actionItems: [
                    {
                        assignee: "Sarah K.",
                        task: "Finalize SSO integration technical docs",
                        dueDate: "Next Friday",
                    },
                    {
                        assignee: "Mike T.",
                        task: "Draft the Q3 onboarding email sequence",
                        dueDate: "August 15th",
                    },
                    {
                        assignee: "Team",
                        task: "Review the finalized pricing tiers for enterprise before launch",
                        dueDate: "August 20th",
                    },
                ],
            },
        });
    } catch (error: any) {
        if (error?.code === "42P01") {
            // Table doesn't exist yet
            return NextResponse.json({
                error: "DatabaseSetupRequired",
                message: "Supabase table 'demo_usage_logs' does not exist. Please create it in the SQL Editor to enable rate limiting."
            }, { status: 500 });
        }

        return NextResponse.json(
            { error: "InternalError", message: "Failed to generate minutes." },
            { status: 500 }
        );
    }
}
