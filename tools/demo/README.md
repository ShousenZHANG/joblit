# Landing demonstration assets

`ApplicationDemo.data.ts` is the single authored source for the prepared demo documents and job postings. All people, roles and employers are fictional. The resume's experience is preserved verbatim; only its prepared summary and selected existing skills vary by role. These files are static samples, not output from a live AI or PDF preview.

To rebuild the six PDFs and three HTML postings:

```sh
node tools/demo/generate.mjs
```

The authoring environment needs Node with the project's existing TypeScript package and Python with ReportLab. Set `DEMO_PYTHON` to a Python executable when it is not on `PATH`. No additional application dependency or API access is required. PDFs use built-in fonts and deterministic metadata.

After rebuilding, check that every PDF has one A4 page, extract its text to confirm the fixture content, and render each with `pdftoppm -png -scale-to 1200` for visual inspection. Verify the published sample links after changing fixture IDs. The application serves all artifacts directly from `public/demo`.
