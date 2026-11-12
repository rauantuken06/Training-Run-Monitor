import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useUrlBackedText } from "./useUrlBackedText";

/**
 * A stand-in for the router: commits are applied to the "URL" only when the test
 * flushes them, the way an asynchronous navigation lags behind fast typing.
 */
function Harness({ queue }: { queue: string[] }) {
  const [url, setUrl] = useState("");
  const [text, change] = useUrlBackedText(url, (v) => queue.push(v));
  return (
    <>
      <input
        aria-label="search"
        value={text}
        onChange={(e) => {
          change(e.target.value);
        }}
      />
      <output aria-label="url">{url}</output>
      <button
        type="button"
        onClick={() => {
          setUrl(queue.shift() ?? url);
        }}
      >
        flush one
      </button>
      <button
        type="button"
        onClick={() => {
          setUrl("");
        }}
      >
        external clear
      </button>
      <button
        type="button"
        onClick={() => {
          setUrl("elsewhere");
        }}
      >
        external set
      </button>
    </>
  );
}

function setup() {
  const queue: string[] = [];
  render(<Harness queue={queue} />);
  const input = screen.getByRole<HTMLInputElement>("textbox", {
    name: "search",
  });
  const type = (word: string) => {
    for (let i = 1; i <= word.length; i++)
      fireEvent.change(input, { target: { value: word.slice(0, i) } });
  };
  const flushOne = () =>
    fireEvent.click(screen.getByRole("button", { name: "flush one" }));
  return { queue, input, type, flushOne };
}

describe("useUrlBackedText", () => {
  it('regression: keeps every keystroke while the URL lags behind (Task 09: "loss" became "lss")', () => {
    const { queue, input, type, flushOne } = setup();
    type("lo");
    flushOne(); // the URL catches up with "l" while "lo" is already typed
    expect(input.value).toBe("lo");
    type("loss");
    flushOne();
    flushOne();
    expect(input.value).toBe("loss");
    while (queue.length > 0) flushOne();
    expect(input.value).toBe("loss");
    expect(screen.getByRole("status", { name: "url" }).textContent).toBe(
      "loss",
    );
  });

  it("adopts a URL change made elsewhere (Clear filters, Back, a link)", () => {
    const { queue, input, type, flushOne } = setup();
    type("nan");
    while (queue.length > 0) flushOne();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "external clear" }));
    });
    expect(input.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "external set" }));
    expect(input.value).toBe("elsewhere");
  });

  it("an external change wins even while own echoes are pending", () => {
    const { input, type } = setup();
    type("abc"); // nothing flushed yet
    fireEvent.click(screen.getByRole("button", { name: "external set" }));
    expect(input.value).toBe("elsewhere");
  });
});
