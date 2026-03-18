import { Navbar, Footer, FontsLayout } from "@/components/ui/fin-tech-landing-page";
import { InteractiveDemo } from "@/components/ui/interactive-demo";

export default function TryPage() {
    return (
        <div className="min-h-screen w-full bg-[#F3F5F7]">
            <FontsLayout />
            <Navbar />
            <div className="pt-16 pb-24">
                <div className="max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 mb-16 text-center">
                    <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-slate-900 mb-6">
                        Experience <span className="text-emerald-700">Secretariat.my</span>
                    </h1>
                    <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
                        Upload a sample recording (up to 5 minutes) to see how our AI instantly generates professional meeting minutes.
                    </p>
                </div>

                <InteractiveDemo />
            </div>
            <Footer />
        </div>
    );
}
