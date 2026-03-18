import { Navbar, PricingSection, Footer, FontsLayout } from "@/components/ui/fin-tech-landing-page";

export default function PricingPage() {
    return (
        <div className="min-h-screen w-full bg-[#F3F5F7]">
            <FontsLayout />
            <Navbar />
            <div className="pt-8 bg-[#F3F5F7]">
                <PricingSection bgClass="bg-[#F3F5F7]" />
            </div>
            <Footer />
        </div>
    );
}
