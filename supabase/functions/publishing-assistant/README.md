# AI Publishing Assistant

The Angular assistant invokes this Supabase Edge Function. The function verifies the signed-in user, checks book ownership, reads book and chapter rows using that user's session, and calls Gemini. It never writes to the books or chapters tables.

## Configure and deploy

1. Link the Supabase CLI to the project if it is not linked already.
2. Set the Gemini credential as a Supabase Edge Function secret named `GEMINI_API_KEY`. Do not add it to Angular environment files, source control, or browser storage.
3. Optionally set `GEMINI_MODEL` as a server secret; the default is `gemini-2.5-flash`.
4. Deploy the `publishing-assistant` function to the same Supabase project used by the Angular app.

The UI requires explicit consent for every session before it enables manuscript analysis or asset generation. Requests are on-demand; generated reports and draft assets are shown in the current page and are not saved to the manuscript. AI output should be reviewed by the author. Copyright and platform-specific recommendations are not legal or platform-policy advice.