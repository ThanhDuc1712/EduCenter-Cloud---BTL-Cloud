import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Dialog } from '@/components/ui/primitives'
import { api } from '@/lib/api'
import { applyServerErrors } from '@/lib/forms'
import * as f from '@/lib/format'
import type { Material } from '@/lib/types'

interface Access {
  url: string
  contentType: string
  expiresAt: string
  ttlSeconds: number
  provider: 'LOCAL' | 'OSS'
}

export const isActive = (m: Pick<Material, 'status'>) => m.status === 'UPLOADING' || m.status === 'PROCESSING'

export function useMaterialAccess() {
  const qc = useQueryClient()
  const [preview, setPreview] = React.useState<{ material: Material; access: Access } | null>(null)
  const open = useMutation({
    mutationFn: async ({ material, kind }: { material: Material; kind: 'preview' | 'download' }) => ({ material, kind, access: await api.get<Access>(`/materials/${material.id}/access`, { kind }) }),
    onSuccess: ({ material, kind, access }) => {
      if (kind === 'preview') setPreview({ material, access })
      else {
        const a = document.createElement('a')
        a.href = access.url
        a.rel = 'noopener'
        a.click()
        toast.success(`Đang tải xuống (liên kết có hiệu lực ${access.ttlSeconds}s)`)
        qc.invalidateQueries({ queryKey: ['materials'] })
      }
    },
    onError: (e) => applyServerErrors(e),
  })
  const dialog = (
    <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)} title={preview ? `Xem trước: ${preview.material.title}` : ''} description={preview ? `Signed URL ${preview.access.provider === 'OSS' ? 'OSS' : 'LOCAL'} · hết hạn ${f.time(preview.access.expiresAt)} · trang đầu` : undefined} size="xl">
      {preview ? preview.access.contentType.startsWith('image/') ? <img src={preview.access.url} alt={`Trang đầu của ${preview.material.title}`} className="mx-auto max-h-[70svh] rounded border" /> : <iframe src={preview.access.url} title={preview.material.title} className="h-[70svh] w-full rounded border" /> : null}
    </Dialog>
  )
  return { open: (material: Material, kind: 'preview' | 'download') => open.mutate({ material, kind }), pending: open.isPending, dialog }
}
