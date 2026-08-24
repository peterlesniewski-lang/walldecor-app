/**
 * This is deliberately a narrow server-to-client projection. Do not add
 * provenance, room-level measurements, assignment rows, or catalog IDs here:
 * installers only need the work scopes assigned to their own Employee row.
 */
export type InstallerRoomView = {
  id: string
  name: string
  sortOrder: number
  measurements: []
  scopes: Array<{
    id: string
    name: string
    sortOrder: number
    scopeProducts: Array<{
      id: string
      productNameSnapshot: string
      productCodeSnapshot: string | null
      manufacturerSnapshot: string | null
      collectionSnapshot: string | null
      sortOrder: number
    }>
    measurements: Array<{
      id: string
      elementName: string
      value: string
      unit: string
    }>
  }>
}

type InstallerRoomSource = {
  id: string
  name: string
  sortOrder: number
  scopes: Array<{
    id: string
    name: string
    sortOrder: number
    scopeProducts: Array<{
      id: string
      productNameSnapshot: string
      productCodeSnapshot: string | null
      manufacturerSnapshot: string | null
      collectionSnapshot: string | null
      sortOrder: number
    }>
    measurements: Array<{
      id: string
      elementName: string
      value: { toString(): string } | string | number
      unit: string
    }>
  }>
}

/** Shared by API and SSR after the query has scoped rows to one Employee. */
export function presentInstallerInstallationRooms(rooms: InstallerRoomSource[]): InstallerRoomView[] {
  return rooms.map((room) => ({
    id: room.id,
    name: room.name,
    sortOrder: room.sortOrder,
    measurements: [],
    scopes: room.scopes.map((scope) => ({
      id: scope.id,
      name: scope.name,
      sortOrder: scope.sortOrder,
      scopeProducts: scope.scopeProducts.map((product) => ({
        id: product.id,
        productNameSnapshot: product.productNameSnapshot,
        productCodeSnapshot: product.productCodeSnapshot,
        manufacturerSnapshot: product.manufacturerSnapshot,
        collectionSnapshot: product.collectionSnapshot,
        sortOrder: product.sortOrder,
      })),
      measurements: scope.measurements.map((measurement) => ({
        id: measurement.id,
        elementName: measurement.elementName,
        value: measurement.value.toString(),
        unit: measurement.unit,
      })),
    })),
  }))
}
