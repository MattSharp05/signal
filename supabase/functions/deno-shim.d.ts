// Type-check shim so `tsc -p supabase/functions` can verify Edge Functions without a Deno install.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
