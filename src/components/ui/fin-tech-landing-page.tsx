"use client";

import React from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, CheckCircle2, FileText, Users, Download, PlayCircle, Zap, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { InteractiveDemo } from "@/components/ui/interactive-demo";
import {
    SUBSCRIPTION_PLANS,
    SUBSCRIPTION_DISPLAY_TIERS,
} from "@/lib/subscription/catalog";

/** Shared Components */
export const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="space-y-1">
        <div className="text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
    </div>
);

export const SoftButton = ({
    children,
    className = "",
    ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
        className={
            "rounded-full px-5 py-2.5 text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-offset-2 " +
            "bg-emerald-900 text-white hover:bg-emerald-800 focus:ring-emerald-700 " +
            className
        }
        {...props}
    >
        {children}
    </button>
);

export function MiniBars() {
    return (
        <div className="mt-6 flex h-36 items-end gap-4 rounded-xl bg-gradient-to-b from-emerald-50 to-white p-4">
            {[18, 48, 72, 96].map((h, i) => (
                <motion.div
                    key={i}
                    initial={{ height: 0, opacity: 0.6 }}
                    animate={{ height: h }}
                    transition={{ delay: 0.5 + i * 0.15, type: "spring" }}
                    className="w-10 rounded-xl bg-gradient-to-t from-emerald-200 to-emerald-400 shadow-inner"
                />
            ))}
        </div>
    );
}

export function Planet() {
    return (
        <motion.svg
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ duration: 2, type: "spring" }}
            width="220"
            height="220"
            viewBox="0 0 220 220"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
            </defs>
            <circle cx="110" cy="110" r="56" fill="url(#grad)" opacity="0.95" />
            <circle cx="94" cy="98" r="10" fill="white" opacity="0.45" />
            <circle cx="132" cy="126" r="8" fill="white" opacity="0.35" />
            <motion.ellipse
                cx="110"
                cy="110"
                rx="100"
                ry="34"
                stroke="white"
                strokeOpacity="0.6"
                fill="none"
                animate={{ strokeDashoffset: [200, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                strokeDasharray="200 200"
            />
            <motion.circle
                cx="210"
                cy="110"
                r="4"
                fill="white"
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 2.2, repeat: Infinity }}
            />
        </motion.svg>
    );
}

export function Navbar() {
    const pathname = usePathname();
    const [isLoggedIn, setIsLoggedIn] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(({ data }) => {
            setIsLoggedIn(Boolean(data.user));
        });
    }, []);

    const navLinks = [
        { label: "Features", href: "/features" },
        { label: "Product", href: "/product" },
        { label: "Security", href: "/security" },
        { label: "Pricing", href: "/pricing" }
    ];

    return (
        <nav className="mx-auto flex w-full max-w-[1180px] items-center justify-between px-4 py-3 md:px-0">
            <Link href="/home" className="flex items-center">
                <Image src="/logo.png" alt="Secretariat Logo" width={477} height={316} className="h-20 w-auto" priority />
            </Link>

            <div className="hidden items-center gap-8 md:flex">
                {navLinks.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.label}
                            href={item.href}
                            className={`text-sm font-medium transition-colors ${isActive ? 'text-emerald-700' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                            {item.label}
                        </Link>
                    );
                })}
            </div>

            <div className="hidden gap-3 md:flex">
                {isLoggedIn ? (
                    <Link href="/">
                        <SoftButton className="inline-flex items-center gap-2">
                            <LayoutDashboard className="h-4 w-4" /> Back to Dashboard
                        </SoftButton>
                    </Link>
                ) : isLoggedIn === false ? (
                    <>
                        <Link href="/login">
                            <button className="rounded-full px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors">
                                Login
                            </button>
                        </Link>
                        <Link href="/try">
                            <SoftButton>Try Demo</SoftButton>
                        </Link>
                    </>
                ) : null}
            </div>
        </nav>
    );
}

export function HeroSection() {
    return (
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-6 px-4 pb-20 md:grid-cols-2 md:px-0 pt-8 lg:pt-12">
            {/* Left: headline */}
            <div className="flex flex-col justify-center space-y-8 pr-2">
                <div>
                    <h1 className="text-5xl md:text-[64px] font-semibold leading-[1.05] tracking-tight text-slate-900">
                        Automate your
                        <br />
                        meeting minutes.
                    </h1>
                    <p className="mt-6 text-lg max-w-md text-slate-600 leading-relaxed">
                        Join forward-thinking teams using{" "}
                        <span className="font-semibold text-slate-900">secretariat.my</span> to instantly
                        generate accurate, structured minutes from any meeting.
                    </p>
                </div>

                <div className="flex items-center gap-4">
                    <Link href="/login">
                        <SoftButton className="px-8 py-3.5 text-base hover:-translate-y-0.5 transition-transform">
                            Start for free <ArrowUpRight className="ml-1 inline h-5 w-5" />
                        </SoftButton>
                    </Link>
                    <button className="flex items-center gap-2 text-slate-600 font-medium hover:text-emerald-700 transition-colors px-4 py-3.5">
                        <PlayCircle className="w-5 h-5" /> Product Tour
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-8 pt-4 md:max-w-sm border-t border-slate-200/60 mt-4">
                    <Stat label="Accuracy Rate" value="99.9%" />
                    <Stat label="Hours Saved" value="1M+" />
                </div>

            </div>

            {/* Right: Interactive Demo */}
            <div className="lg:pl-6 pt-6 md:pt-0 flex items-center justify-center">
                <InteractiveDemo />
            </div>
        </div>
    );
}

export function FeaturesSection({ bgClass = "bg-white" }: { bgClass?: string }) {
    return (
        <div className={`py-24 px-4 sm:px-6 lg:px-8 border-t border-slate-200/60 ${bgClass}`}>
            <div className="mx-auto max-w-[1180px]">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 mb-4">
                        Everything a Secretary Does, <br className="hidden sm:block" />
                        <span className="text-emerald-700">But Instant.</span>
                    </h2>
                    <p className="text-slate-600 max-w-2xl mx-auto text-lg">
                        Stop worrying about taking notes. Participate fully in the discussion while our AI handles the documentation with bank-grade security.
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-8">
                    <motion.div whileHover={{ y: -5 }} className="rounded-2xl bg-slate-50 p-8 shadow-sm ring-1 ring-slate-100 transition-all">
                        <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 mb-6 shadow-sm">
                            <FileText className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 mb-3">Smart Structuring</h3>
                        <p className="text-slate-600 text-sm leading-relaxed">
                            Automatically identifies topics, decisions made, and structures them into a professional Minutes of Meeting (MoM) format.
                        </p>
                    </motion.div>

                    <motion.div whileHover={{ y: -5 }} className="relative overflow-hidden rounded-2xl bg-slate-50 p-8 shadow-sm ring-1 ring-slate-100 transition-all">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100/50 blur-[40px] rounded-full pointer-events-none"></div>
                        <div className="relative z-10 w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 mb-6 shadow-sm">
                            <Users className="w-6 h-6" />
                        </div>
                        <h3 className="relative z-10 text-xl font-semibold text-slate-900 mb-3">Action Delegation</h3>
                        <p className="relative z-10 text-slate-600 text-sm leading-relaxed">
                            Extracts &quot;Who does What by When&quot; and highlights action items clearly so nothing falls through the cracks.
                        </p>
                    </motion.div>

                    <motion.div whileHover={{ y: -5 }} className="rounded-2xl bg-slate-50 p-8 shadow-sm ring-1 ring-slate-100 transition-all">
                        <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-700 mb-6 shadow-sm">
                            <Download className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 mb-3">1-Click Export</h3>
                        <p className="text-slate-600 text-sm leading-relaxed">
                            Download your generated minutes instantly in perfectly formatted PDF or Word Document ready to be emailed to stakeholders.
                        </p>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}

export function HowItWorksSection({ bgClass = "bg-[#F3F5F7]" }: { bgClass?: string }) {
    return (
        <div className={`py-24 px-4 sm:px-6 lg:px-8 ${bgClass}`}>
            <div className="mx-auto max-w-[1180px]">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 mb-4">How It Works</h2>
                    <p className="text-slate-600 max-w-2xl mx-auto text-lg">Three simple steps to perfect meeting minutes.</p>
                </div>

                <div className="grid md:grid-cols-3 gap-12 relative max-w-4xl mx-auto">
                    {/* Connecting Line */}
                    <div className="hidden md:block absolute top-[40px] left-[15%] right-[15%] h-[2px] bg-slate-200 -z-10"></div>

                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto bg-white rounded-2xl flex items-center justify-center text-emerald-700 mb-6 shadow-md ring-1 ring-slate-100 rotate-3 transition-transform hover:rotate-0">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3-3m3-3v12" />
                            </svg>
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 mb-3 flex items-center justify-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-xs text-slate-700 font-bold">1</span>
                            Upload
                        </h3>
                        <p className="text-slate-500 text-sm">Drag and drop your audio recordings (MP3, WAV) or text transcripts.</p>
                    </div>

                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto bg-emerald-700 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg shadow-emerald-900/20 -rotate-3 transition-transform hover:rotate-0">
                            <Zap className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 mb-3 flex items-center justify-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-xs text-slate-700 font-bold">2</span>
                            AI Analysis
                        </h3>
                        <p className="text-slate-500 text-sm">Our engine intelligently processes the content, structuring topics and extracting actions.</p>
                    </div>

                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto bg-white rounded-2xl flex items-center justify-center text-emerald-700 mb-6 shadow-md ring-1 ring-slate-100 rotate-3 transition-transform hover:rotate-0">
                            <Download className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-semibold text-slate-900 mb-3 flex items-center justify-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-200 text-xs text-slate-700 font-bold">3</span>
                            Download
                        </h3>
                        <p className="text-slate-500 text-sm">Export your perfectly formatted Minutes of Meeting in PDF or Word format instantly.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function PricingCardAction({
    tier,
    planLabel,
    isFeatured,
    currentPlan,
    isLoggedIn,
    hasPaidPlan,
}: {
    tier: string;
    planLabel: string;
    isFeatured: boolean;
    currentPlan: string | null | undefined;
    isLoggedIn: boolean;
    hasPaidPlan: boolean;
}) {
    const baseBtn = `w-full rounded-full py-3 font-medium transition-colors ${isFeatured
        ? "bg-white text-emerald-900 hover:bg-slate-50"
        : "bg-slate-100 text-slate-900 hover:bg-slate-200"
        }`;

    // Still loading auth/plan — neutral placeholder to avoid flicker
    if (currentPlan === null) {
        return <div className={`${baseBtn} opacity-60`} aria-hidden="true">&nbsp;</div>;
    }

    const isCurrent = isLoggedIn && currentPlan === tier;

    if (isCurrent) {
        return (
            <div className="space-y-2">
                <div className={`flex items-center justify-center gap-2 rounded-full py-3 font-medium ${isFeatured ? "bg-white/15 text-white" : "bg-emerald-50 text-emerald-800"}`}>
                    <CheckCircle2 className="h-4 w-4" /> Current plan
                </div>
                {tier !== "free" ? (
                    <a href="/api/billing/portal" className="block">
                        <button className={`w-full rounded-full py-2.5 text-sm font-medium transition-colors ${isFeatured ? "text-emerald-50 hover:bg-white/10" : "text-emerald-700 hover:bg-emerald-50"}`}>
                            Manage billing
                        </button>
                    </a>
                ) : null}
            </div>
        );
    }

    // Logged-in with an active paid subscription → route plan changes through the portal
    if (hasPaidPlan) {
        return (
            <a href="/api/billing/portal" className="w-full">
                <button className={baseBtn}>Manage billing</button>
            </a>
        );
    }

    // Free user or guest → subscribe via checkout / sign up
    const href = tier === "free" ? "/login" : `/api/billing/checkout?tier=${tier}`;
    const label = tier === "free" ? "Start free" : `Choose ${planLabel}`;
    return (
        <Link href={href} className="w-full">
            <button className={baseBtn}>{label}</button>
        </Link>
    );
}

export function PricingSection({ bgClass = "bg-white" }: { bgClass?: string }) {
    const tierDescriptions: Record<string, string> = {
        free: "Try the full workflow free",
        pro: "For working Company Secretaries",
        premium: "Unlimited meetings, priority support",
    };

    // null = still loading, undefined = guest (not logged in)
    const [currentPlan, setCurrentPlan] = React.useState<string | null | undefined>(null);

    React.useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then(async ({ data }) => {
            if (!data.user) {
                setCurrentPlan(undefined);
                return;
            }
            const { data: profile } = await supabase
                .from("profiles")
                .select("plan")
                .eq("id", data.user.id)
                .single();
            setCurrentPlan(profile?.plan ?? "free");
        });
    }, []);

    const isLoggedIn = typeof currentPlan === "string";
    const hasPaidPlan = currentPlan === "pro" || currentPlan === "premium";

    // Credit top-up slider
    const [creditPriceRm, setCreditPriceRm] = React.useState(0.20);
    const [creditsPerHour, setCreditsPerHour] = React.useState(4);
    const [topupCredits, setTopupCredits] = React.useState(100);

    React.useEffect(() => {
        const supabase = createClient();
        supabase
            .from("organization_billing_settings")
            .select("credit_price_rm, credits_per_transcription_hour")
            .maybeSingle()
            .then(({ data }) => {
                if (data?.credit_price_rm != null) setCreditPriceRm(Number(data.credit_price_rm));
                if (data?.credits_per_transcription_hour != null) setCreditsPerHour(Math.max(1, Number(data.credits_per_transcription_hour)));
            });
    }, []);

    const topupTotalRm = (topupCredits * creditPriceRm).toFixed(2);

    return (
        <div className={`py-24 px-4 sm:px-6 lg:px-8 border-t border-slate-200/60 relative overflow-hidden ${bgClass}`}>
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-emerald-50/50 rounded-full blur-[100px] pointer-events-none transform translate-x-1/3 -translate-y-1/3 text-emerald-50"></div>

            <div className="mx-auto max-w-[1180px] relative z-10">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 mb-4">Simple, Transparent Pricing</h2>
                    <p className="text-slate-600 max-w-2xl mx-auto text-lg">Choose the plan that fits your workflow, then top up credits or transcription hours only when you need more.</p>
                    {isLoggedIn ? (
                        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-800">
                            Your plan: {SUBSCRIPTION_PLANS[currentPlan as keyof typeof SUBSCRIPTION_PLANS]?.label ?? "Free"}
                        </p>
                    ) : null}
                </div>

                <div className="grid gap-8 lg:grid-cols-3 max-w-4xl mx-auto">
                    {SUBSCRIPTION_DISPLAY_TIERS.map((tier) => {
                        const plan = SUBSCRIPTION_PLANS[tier];
                        const isFeatured = tier === "pro";

                        return (
                            <div
                                key={tier}
                                className={`relative flex flex-col rounded-2xl p-8 ${isFeatured
                                    ? "bg-gradient-to-b from-emerald-900 to-emerald-800 shadow-xl"
                                    : "bg-white shadow-sm ring-1 ring-slate-200"
                                    }`}
                            >
                                {isFeatured ? (
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-4 py-1.5 text-xs font-bold tracking-wide text-emerald-800 shadow-sm">
                                        BEST VALUE
                                    </div>
                                ) : null}
                                <h3 className={`text-xl font-semibold ${isFeatured ? "text-emerald-50" : "text-slate-900"}`}>{plan.label}</h3>
                                <p className={`mt-2 text-sm ${isFeatured ? "text-emerald-100/80" : "text-slate-500"}`}>
                                    {tierDescriptions[tier]}
                                </p>
                                <div className={`mb-6 mt-6 text-4xl font-semibold tracking-tight ${isFeatured ? "text-white" : "text-slate-900"}`}>
                                    RM {plan.priceRmMonthly}
                                    <span className={`text-lg font-normal ${isFeatured ? "text-emerald-100/80" : "text-slate-500"}`}>/mo</span>
                                </div>

                                <ul className={`mb-8 flex-1 space-y-4 text-sm ${isFeatured ? "text-emerald-50" : "text-slate-700"}`}>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> {plan.operatorsLabel}</li>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> {plan.committeeAllowanceLabel}</li>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> {plan.transcriptReviewJobs >= 999 ? 'Unlimited' : plan.transcriptReviewJobs} meetings / month</li>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> {plan.includedCredits} credits / month (≈ {Math.floor(plan.includedCredits / creditsPerHour)} hrs transcription)</li>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> Claude Sonnet 4 AI engine</li>
                                    <li className="flex items-center gap-3"><CheckCircle2 className={`h-5 w-5 ${isFeatured ? "text-emerald-300" : "text-emerald-600"}`} /> {plan.supportLabel}</li>
                                </ul>

                                <PricingCardAction
                                    tier={tier}
                                    planLabel={plan.label}
                                    isFeatured={isFeatured}
                                    currentPlan={currentPlan}
                                    isLoggedIn={isLoggedIn}
                                    hasPaidPlan={hasPaidPlan}
                                />
                            </div>
                        );
                    })}
                </div>

                <div className="mx-auto mt-14 max-w-3xl rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
                    <div className="text-center">
                        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">Top up credits</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">
                            One balance for everything — transcription and AI features. Buy as many credits as you need.
                        </p>
                    </div>

                    <div className="mt-8">
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="text-4xl font-semibold tracking-tight text-slate-900">{topupCredits}<span className="ml-2 text-lg font-normal text-slate-500">credits</span></p>
                            </div>
                            <p className="text-3xl font-semibold tracking-tight text-emerald-800">RM {topupTotalRm}</p>
                        </div>

                        <input
                            type="range"
                            min={10}
                            max={2000}
                            step={10}
                            value={topupCredits}
                            onChange={(e) => setTopupCredits(Number(e.target.value))}
                            className="mt-5 w-full accent-emerald-700"
                        />
                        <div className="mt-1 flex justify-between text-xs text-slate-400">
                            <span>10</span>
                            <span>2000</span>
                        </div>

                        <Link
                            href={isLoggedIn ? `/api/billing/topup?credits=${topupCredits}` : "/login?next=/pricing"}
                            className="mt-6 block"
                        >
                            <SoftButton className="w-full py-3.5 text-base">
                                Buy {topupCredits} credits — RM {topupTotalRm}
                            </SoftButton>
                        </Link>
                        <p className="mt-3 text-center text-xs text-slate-500">
                            RM {creditPriceRm.toFixed(2)} per credit · charged once, credits never expire.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function Footer() {
    return (
        <footer className="border-t border-slate-200/60 bg-white pt-16 pb-8">
            <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
                <div className="md:col-span-2">
                    <Link href="/home" className="flex items-center mb-4">
                        <Image src="/logo.png" alt="Secretariat Logo" width={400} height={100} className="h-24 w-auto" />
                    </Link>
                    <p className="text-slate-500 text-sm max-w-sm mb-6 leading-relaxed">
                        Empowering professionals globally by turning hours of meetings into minutes of action. Hosted securely in the cloud.
                    </p>
                </div>

                <div>
                    <h4 className="font-semibold text-slate-900 mb-4">Product</h4>
                    <ul className="space-y-3 text-sm text-slate-500">
                        <li><Link href="/features" className="hover:text-emerald-700 transition-colors">Features</Link></li>
                        <li><Link href="/pricing" className="hover:text-emerald-700 transition-colors">Pricing</Link></li>
                        <li><Link href="/product" className="hover:text-emerald-700 transition-colors">Product</Link></li>
                        <li><Link href="/security" className="hover:text-emerald-700 transition-colors">Security</Link></li>
                    </ul>
                </div>

                <div>
                    <h4 className="font-semibold text-slate-900 mb-4">Legal</h4>
                    <ul className="space-y-3 text-sm text-slate-500">
                        <li><Link href="#" className="hover:text-emerald-700 transition-colors">Privacy Policy</Link></li>
                        <li><Link href="#" className="hover:text-emerald-700 transition-colors">Terms of Service</Link></li>
                        <li><Link href="#" className="hover:text-emerald-700 transition-colors">Data Security</Link></li>
                        <li><Link href="#" className="hover:text-emerald-700 transition-colors">Cookie Policy</Link></li>
                    </ul>
                </div>
            </div>

            <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between border-t border-slate-100 pt-8 mt-8">
                <p className="text-sm text-slate-400 mb-4 md:mb-0">© {new Date().getFullYear()} Secretariat.my, Inc. All rights reserved.</p>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span>Designed with</span>
                    <span className="text-emerald-500">♥</span>
                    <span>for modern teams</span>
                </div>
            </div>
        </footer>
    );
}

export function FontsLayout() {
    return (
        <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
      :root { --font-sans: 'Plus Jakarta Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; }
      body { font-family: var(--font-sans); }
    `}</style>
    );
}

export default function SecretariatLandingPage() {
    return (
        <div className="min-h-screen w-full bg-[#F3F5F7]">
            <FontsLayout />
            <Navbar />
            <HeroSection />
            <FeaturesSection />
            <HowItWorksSection />
            <PricingSection />
            <Footer />
        </div>
    );
}
