import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ProductProfile, ProfileHeader } from '@/components/product/ProductProfile'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/overlay'
import { useProduct } from '@/data/hooks'

export default function ProductPage() {
  const { slug } = useParams()
  const { data, isLoading } = useProduct(slug ?? null)
  const navigate = useNavigate()
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-5 sm:px-8">
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <ArrowLeft /> Back
        </Button>
        {isLoading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : data ? (
          <div className="space-y-5">
            <ProfileHeader d={data} />
            <ProductProfile d={data} />
          </div>
        ) : (
          <EmptyState title="Product not found" action={<Link to="/" className="text-accent">Back to Discover</Link>} />
        )}
      </div>
    </div>
  )
}
