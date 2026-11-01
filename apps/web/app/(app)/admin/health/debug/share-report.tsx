'use client'

import { useState } from 'react'
import { Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { CopyButton } from '@/components/ui/copy-button'

const ISSUES_URL = 'https://github.com/PrintBench/printbench/issues/new'

function save(filename: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Hands the report over in the shape a GitHub issue wants.
 *
 * The log excerpt is the only part that is free text from this instance, so
 * it is the one thing that can be left out, and the preview is right there to
 * read before anything is pasted in public.
 */
export function ShareReport({
  markdown,
  markdownWithoutLogs,
  json,
  logLines,
}: {
  markdown: string
  markdownWithoutLogs: string
  json: string
  logLines: number
}) {
  const [includeLogs, setIncludeLogs] = useState(true)

  const text = includeLogs ? markdown : markdownWithoutLogs
  const stamp = new Date().toISOString().slice(0, 10)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share with a bug report</CardTitle>
        <CardDescription>
          The report contains versions, settings, counts and states. It leaves out hostnames, URLs,
          file paths, email addresses and the names of your users, libraries and models, and it
          never includes passwords or keys.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Nothing to include when the log has no warnings or errors. */}
        {logLines > 0 && (
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={includeLogs}
              onChange={(event) => setIncludeLogs(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              Include the last{' '}
              {logLines === 1 ? 'warning or error' : `${logLines} warnings and errors`} from the log
              <span className="block text-xs text-[var(--color-ink-muted)]">
                Usually the most useful part. Log lines are real text from your instance and can
                mention file and library names, so read the preview before posting it publicly.
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* Clipboard access needs HTTPS or localhost; without it, the
              download and the preview below are the way to get the text. */}
          <CopyButton value={text} label="Copy for GitHub" variant="primary" size="md" />
          <Button
            variant="secondary"
            onClick={() => save(`printbench-debug-${stamp}.md`, 'text/markdown', text)}
          >
            <Download />
            Markdown
          </Button>
          <Button
            variant="secondary"
            onClick={() => save(`printbench-debug-${stamp}.json`, 'application/json', json)}
          >
            <Download />
            JSON
          </Button>
          <Button asChild variant="ghost">
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              <ExternalLink />
              Open an issue
            </a>
          </Button>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Preview what will be shared
          </summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-[var(--radius-control)] bg-[var(--color-surface-2)] p-3 font-mono text-xs leading-5">
            {text}
          </pre>
        </details>
      </CardContent>
    </Card>
  )
}
