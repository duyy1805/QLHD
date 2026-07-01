# Project rules

- This is a Next.js App Router project using TypeScript and shadcn/ui.
- Preserve UTF-8 encoding and Vietnamese text.
- On Windows, do not use PowerShell Get-Content/Set-Content defaults for files containing Vietnamese text. Use apply_patch, Node fs.readFileSync/writeFileSync with utf8, or explicit .NET UTF-8 encoding.
- After editing Vietnamese UI text, run a mojibake scan before finishing.
- Do not rewrite entire files unless explicitly requested.
- Prefer small, minimal patches.
- Do not change business logic unless requested.
- For client components using hooks, keep or add "use client".
- Use imports from "@/components/ui/\*".
- If a shadcn/ui component is missing, tell the user the install command instead of inventing files.
