import { render, screen } from "@testing-library/react";
import NotFoundPage from "../not-found";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("NotFoundPage", () => {
  it("renders the not-found page container", () => {
    render(<NotFoundPage />);
    expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
  });

  it("shows 'Page not found' text", () => {
    render(<NotFoundPage />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("has a link to '/' with 'Go home' text", () => {
    render(<NotFoundPage />);
    const link = screen.getByRole("link", { name: "Go home" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/");
  });
});
