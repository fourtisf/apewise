import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { TrustStrip } from "@/components/TrustStrip";
import { Problem } from "@/components/Problem";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { WhyApeWise } from "@/components/WhyApeWise";
import { SocialProof } from "@/components/SocialProof";
import { Pricing } from "@/components/Pricing";
import { Waitlist } from "@/components/Waitlist";
import { Footer } from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TrustStrip />
        <Problem />
        <Features />
        <HowItWorks />
        <WhyApeWise />
        <SocialProof />
        <Pricing />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
