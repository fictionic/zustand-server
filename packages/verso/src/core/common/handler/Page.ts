import type {ReactElement} from "react";
import type {MaybePromise} from "../util/types";
import type {
  LinkTag,
  MetaTag,
  Script,
  Stylesheet,
} from "./PageHeader";
import {
  defineRouteHandler,
  type RouteHandler,
  type RouteHandlerDefinition,
  type RouteHandlerInit,
  type StandardizedRouteHandler,
} from "./RouteHandler";

declare module './RouteHandler' {
  interface HandlerRegistry {
    page: { optional: PageOptionalMethods; required: PageRequiredMethods };
  }
}

export interface PageOptionalMethods {
  getTitle(): MaybePromise<string | null>;
  getStylesheets(): MaybePromise<Stylesheet[]>;
  getScripts(): MaybePromise<Script[]>;
  getLinkTags(): MaybePromise<LinkTag[]>;
  getMetaTags(): MaybePromise<MetaTag[]>;
  getBodyClasses(): MaybePromise<string[]>;
  // TODO: getBodyStartContent
}

export interface PageRequiredMethods {
  getElements(): ReactElement[]; // TODO should this become optional once proxyRoute is implemented?
};

export type Page = RouteHandler<'page', PageOptionalMethods, PageRequiredMethods>;

export type PageInit = RouteHandlerInit<'page', Page>;

export type PageDefinition = RouteHandlerDefinition<'page', PageOptionalMethods, PageRequiredMethods>;

export type StandardizedPage = StandardizedRouteHandler<'page', PageOptionalMethods, PageRequiredMethods>;

const PAGE_REQUIRED_METHOD_NAMES: (keyof PageRequiredMethods)[] = ['getElements'];

const PAGE_OPTIONAL_METHOD_DEFAULTS: PageOptionalMethods = {
  getTitle: () => null,
  getStylesheets: () => [],
  getScripts: () => [],
  getLinkTags: () => [],
  getMetaTags: () => [],
  getBodyClasses: () => [],
};

export function definePage(init: PageInit): PageDefinition {
  return defineRouteHandler('page', init, PAGE_OPTIONAL_METHOD_DEFAULTS, PAGE_REQUIRED_METHOD_NAMES);
}

export * from './PageHeader';
