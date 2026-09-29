import { render, screen } from "@testing-library/react";
import HelpPage from "../page";
import { FAQ_SECTIONS, SUPPORT_EMAIL } from "../faq";

describe("Help & FAQ page", () => {
  it("renders every FAQ section and question", () => {
    render(<HelpPage />);
    expect(screen.getByRole("heading", { level: 1, name: /help & faq/i })).toBeInTheDocument();
    for (const section of FAQ_SECTIONS) {
      expect(screen.getByRole("heading", { level: 2, name: section.title })).toBeInTheDocument();
      for (const item of section.items) {
        expect(screen.getByText(item.question)).toBeInTheDocument();
      }
    }
  });

  it("covers the questions pilot users ask most: fees, disputes and cNGN", () => {
    const questions = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => i.question.toLowerCase()));
    expect(questions.some((q) => q.includes("fee"))).toBe(true);
    expect(questions.some((q) => q.includes("dispute"))).toBe(true);
    expect(questions.some((q) => q.includes("cngn"))).toBe(true);
  });

  it("shows a support contact link", () => {
    render(<HelpPage />);
    const link = screen.getByRole("link", { name: SUPPORT_EMAIL });
    expect(link).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
  });

  it("uses unique ids so questions can be deep-linked", () => {
    const ids = FAQ_SECTIONS.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
