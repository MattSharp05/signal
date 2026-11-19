import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/overlay'
import { useAddProduct } from '@/data/hooks'

export function AddProductDialog({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const add = useAddProduct()
  const navigate = useNavigate()
  const [warnings, setWarnings] = useState<string[]>([])
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          add.reset()
          setWarnings([])
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size={compact ? 'icon' : 'md'} aria-label="Add product">
          <Plus />
          {compact ? null : 'Add product'}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a product"
        description="Paste a product's website. Signal checks for an existing profile, reads the public site (respecting robots.txt) and enriches it from connected sources."
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            const r = await add.mutateAsync(url)
            if (r.warnings.length) setWarnings(r.warnings)
            else setOpen(false)
            navigate(`?p=${encodeURIComponent(r.slug)}`)
          }}
        >
          <Input autoFocus placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          {add.isError ? <p className="text-xs text-negative">{(add.error as Error).message}</p> : null}
          {warnings.length ? (
            <ul className="space-y-1 rounded bg-warning-soft p-2 text-xs text-warning">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {warnings.length ? 'Close' : 'Cancel'}
            </Button>
            {!warnings.length ? (
              <Button type="submit" variant="primary" disabled={!url.trim() || add.isPending}>
                {add.isPending ? <Loader2 className="animate-spin" /> : null}
                {add.isPending ? 'Researching…' : 'Add & research'}
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
