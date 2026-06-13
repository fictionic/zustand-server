import {describe, test, expect} from "vitest";
import {definePage} from "../core/common/handler/Page";
import type {RoutesMap} from "../build/config";
import {parseHtml, responseBodyAsString, runRoute} from "./helpers/runAppHarness";

// just a smoke test for the harness
describe("runApp harness smoke test", () => {
  test("a single-root page renders a full HTML document", async () => {
    const routes: RoutesMap = {
      home: {path: "/", handler: "HomeHandler"},
    };
    const page = definePage(() => ({
      getRouteDirective: () => ({kind: "ok"}),
      getElements: () => [<div>Hello</div>],
    }));

    const response = await runRoute(page, routes, new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const body = await responseBodyAsString(response);
    expect(body).toContain("<!DOCTYPE html>");

    const doc = parseHtml(body);
    expect(doc.querySelector("div[data-verso-root]")?.textContent).toBe("Hello");
  });
});
