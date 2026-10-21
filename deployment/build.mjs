import { copyFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const assets = [
  'index.html',
  'app.js',
  'finance.js',
  'styles.css',
  'favicon.svg',
  'sample-statement.csv',
  'samples/tuition-invoice.pdf',
  'samples/tuition-invoice.txt',
]

for (const asset of assets) {
  const target = resolve('public', asset)
  await mkdir(dirname(target), { recursive: true })
  await copyFile(asset, target)
}
