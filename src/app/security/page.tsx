import { Navbar, Footer, FontsLayout } from "@/components/ui/fin-tech-landing-page";
import { Shield, Lock, Server, EyeOff, FileCheck2, KeyRound, Activity } from "lucide-react";

const securityFeatures = [
    {
        icon: <Lock className="w-6 h-6" />,
        title: "Bank-Grade Encryption",
        description: "All data is encrypted at rest using AES-256 and in transit via TLS 1.3, ensuring your meeting audio and transcripts are always secure."
    },
    {
        icon: <EyeOff className="w-6 h-6" />,
        title: "Zero Data Retention",
        description: "Your audio files are permanently deleted from our servers immediately after the AI finishes transcribing and generating the minutes."
    },
    {
        icon: <Server className="w-6 h-6" />,
        title: "Secure Infrastructure",
        description: "Hosted on enterprise-grade cloud providers with isolated environments, preventing unauthorized access and data leakage."
    },
    {
        icon: <FileCheck2 className="w-6 h-6" />,
        title: "PDPA & GDPR Ready",
        description: "Designed from the ground up to comply with global data protection regulations, giving you full control over your organization's data."
    },
    {
        icon: <KeyRound className="w-6 h-6" />,
        title: "Strict Access Control",
        description: "Granular role-based access control (RBAC) ensures that only authorized personnel can view or download the generated meeting minutes."
    },
    {
        icon: <Activity className="w-6 h-6" />,
        title: "Continuous Monitoring",
        description: "Our systems undergo 24/7 automated security scanning and regular penetration testing to identify and patch vulnerabilities instantly."
    }
];

export default function SecurityPage() {
    return (
        <div className="min-h-screen w-full bg-[#F3F5F7] font-sans">
            <FontsLayout />
            <Navbar />

            <main className="pt-16 pb-24">
                {/* Header Section */}
                <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 mb-20 text-center">
                    <div className="inline-flex items-center justify-center p-4 bg-emerald-100/50 rounded-2xl mb-8 ring-1 ring-emerald-200 shadow-sm">
                        <Shield className="w-12 h-12 text-emerald-700" />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 mb-6">
                        Your Data, <span className="text-emerald-700">Locked Down.</span>
                    </h1>
                    <p className="text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
                        We treat your meeting minutes with the same level of security as financial transactions. Privacy and confidentiality are built into our core.
                    </p>
                </div>

                {/* Security Grid */}
                <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {securityFeatures.map((feature, idx) => (
                            <div key={idx} className="bg-white rounded-2xl p-8 shadow-sm ring-1 ring-slate-200 hover:shadow-md transition-shadow">
                                <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700 mb-6 ring-1 ring-emerald-100">
                                    {feature.icon}
                                </div>
                                <h3 className="text-xl font-semibold text-slate-900 mb-3">{feature.title}</h3>
                                <p className="text-slate-600 leading-relaxed text-sm">
                                    {feature.description}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Commitment Banner */}
                <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 mt-24">
                    <div className="bg-slate-900 rounded-3xl p-10 md:p-16 text-center shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none transform translate-x-1/2 -translate-y-1/2"></div>
                        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/20 rounded-full blur-[80px] pointer-events-none transform -translate-x-1/2 translate-y-1/2"></div>

                        <h3 className="relative z-10 text-2xl md:text-3xl font-semibold text-white mb-4">Our Security Commitment</h3>
                        <p className="relative z-10 text-slate-300 max-w-2xl mx-auto text-lg mb-8">
                            We never train our AI models on your private meeting data. Your corporate intelligence remains strictly yours.
                        </p>
                        <div className="relative z-10 inline-flex items-center gap-2 text-emerald-400 font-medium bg-emerald-400/10 px-6 py-3 rounded-full ring-1 ring-emerald-400/20">
                            <Shield className="w-5 h-5" />
                            100% Confidential
                        </div>
                    </div>
                </div>
            </main>

            <Footer />
        </div>
    );
}
