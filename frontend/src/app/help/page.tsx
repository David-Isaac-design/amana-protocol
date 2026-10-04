import type { Metadata } from "next";
import { FAQ_SECTIONS, SUPPORT_EMAIL } from "./faq";

export const metadata: Metadata = {
  title: "Help & FAQ",
  description: "Answers to common questions about fees, disputes and cNGN, and how to contact support.",
};

export default function HelpPage() {
  return (
    <main className="px-6 py-8 max-w-3xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-text-primary">Help &amp; FAQ</h1>
        <p className="text-text-secondary">
          Answers to the questions pilot users ask most. Can&apos;t find what you need? Contact support below.
        </p>
      </header>

      <nav aria-label="FAQ sections" className="flex flex-wrap gap-2">
        {FAQ_SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-full border border-border-default px-3 py-1 text-sm text-text-secondary hover:text-gold"
          >
            {section.title}
          </a>
        ))}
      </nav>

      {FAQ_SECTIONS.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="space-y-3">
          <h2 id={`${section.id}-title`} className="text-xl font-semibold text-text-primary">
            {section.title}
          </h2>
          {section.items.map((item) => (
            <details
              key={item.id}
              id={item.id}
              className="bg-bg-elevated rounded-lg border border-border-default p-4 group"
            >
              <summary className="cursor-pointer font-medium text-text-primary">{item.question}</summary>
              <div className="mt-3 space-y-2 text-text-secondary">
                {item.answer.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))}
        </section>
      ))}

      <section
        id="contact"
        aria-labelledby="contact-title"
        className="bg-bg-elevated rounded-lg border border-border-default p-6 space-y-2"
      >
        <h2 id="contact-title" className="text-xl font-semibold text-text-primary">
          Contact support
        </h2>
        <p className="text-text-secondary">
          Email{" "}
          <a className="text-gold underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          . Include your trade ID if your question is about a specific trade. We will never ask for your
          recovery phrase or private key.
        </p>
      </section>
    </main>
  );
}
