/** The slice of the Deno runtime our Edge Function entry points use. */
declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
  env: { get(name: string): string | undefined };
};
