import { basename, join } from 'node:path'

import sharp from 'sharp'

import { env } from '@/lib/env'
import type { CropInput } from '@/lib/schemas'
import { ApiError } from '@/server/adapters/types'
import { readDimensions } from '@/server/adapters/sharp'
import type { Asset } from '@/server/db/schema'

import { assetFilePath, getAsset, registerAsset } from './assets'
import { touchOrder } from './orders'
import { bucketDir } from './paths'

/**
 * Przycięcie kadru.
 *
 * Operacja deterministyczna i tania — `sharp.extract()` na pliku PNG trwa
 * milisekundy. Dlatego **nie idzie przez kolejkę**: zadanie w kolejce ma sens
 * przy czymś, co trwa minuty i może zająć GPU. Tutaj grafik kliknąłby
 * „przytnij" i patrzył na pasek postępu dłużej, niż trwa samo cięcie.
 *
 * Powstaje nowy kadr, pierwowzór zostaje. Przycięcie jest nieodwracalne
 * w pliku, ale odwracalne w zleceniu: wystarczy wrócić do oryginału.
 *
 * Warstwa serwisów nie importuje niczego z `next/*`.
 */
export async function cropAsset(assetId: string, prostokat: CropInput): Promise<Asset> {
  const source = getAsset(assetId)

  if (source.mime.startsWith('video/')) {
    throw new ApiError('VALIDATION_FAILED', 'przycinać można kadr, nie klip', 400)
  }

  const sourcePath = assetFilePath(source)
  const wymiary = await readDimensions(sourcePath)

  if (wymiary === null) {
    throw new ApiError('VALIDATION_FAILED', 'nie da się odczytać wymiarów kadru', 400)
  }

  // Prostokąt musi mieścić się w obrazie. Bez tego sharp rzuca własnym błędem,
  // którego treść trafiłaby do grafika — a ma widzieć zdanie po polsku.
  const miesciSie =
    prostokat.left + prostokat.width <= wymiary.width &&
    prostokat.top + prostokat.height <= wymiary.height

  if (!miesciSie) {
    throw new ApiError('VALIDATION_FAILED', 'zaznaczenie wychodzi poza kadr', 400)
  }

  const katalog = bucketDir(env.STUDIO_DATA_DIR, source.orderId, 'generated')
  const nazwa = basename(sourcePath).replace(/\.(png|jpe?g|webp|avif)$/i, '')
  const wyjscie = join(katalog, `${nazwa}-kadr-${String(Date.now())}.png`)

  await sharp(sourcePath).extract(prostokat).png().toFile(wyjscie)

  const poWycieciu = await readDimensions(wyjscie)

  const asset = await registerAsset({
    orderId: source.orderId,
    jobId: null,
    kind: 'generated',
    absolutePath: wyjscie,
    mime: 'image/png',
    width: poWycieciu?.width,
    height: poWycieciu?.height,
    // Numer losowania wędruje za kadrem: przycięty fragment nadal pochodzi
    // z tego losowania i nadal da się go odtworzyć.
    seed: source.seed ?? undefined,
    metadata: {
      przycietyZ: source.id,
      prostokat,
      hasAlpha: poWycieciu?.hasAlpha ?? false,
    },
  })

  touchOrder(source.orderId)
  return asset
}
