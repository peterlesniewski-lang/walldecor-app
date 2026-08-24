export type InstallerInstallationOrderView = {
  id: string
  number: string
  status: string
  archivedAt: Date | string | null
  client: { name: string }
  addressStreet: string
  addressBuildingNumber: string | null
  addressApartmentNumber: string | null
  addressPostalCode: string
  addressCity: string
  primaryEmployee: { firstName: string; lastName: string }
  backupEmployee: { firstName: string; lastName: string }
}

type InstallerInstallationOrderSource = {
  id: string
  number: string
  status: string
  archivedAt: Date | string | null
  client: { name: string }
  addressStreet: string
  addressBuildingNumber: string | null
  addressApartmentNumber: string | null
  addressPostalCode: string
  addressCity: string
  primaryEmployee: { firstName: string; lastName: string }
  backupEmployee: { firstName: string; lastName: string }
}

/** Explicit Flight-safe allowlist for the installer-facing Client Component. */
export function presentInstallerInstallationOrder(order: InstallerInstallationOrderSource): InstallerInstallationOrderView {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    archivedAt: order.archivedAt,
    client: { name: order.client.name },
    addressStreet: order.addressStreet,
    addressBuildingNumber: order.addressBuildingNumber,
    addressApartmentNumber: order.addressApartmentNumber,
    addressPostalCode: order.addressPostalCode,
    addressCity: order.addressCity,
    primaryEmployee: {
      firstName: order.primaryEmployee.firstName,
      lastName: order.primaryEmployee.lastName,
    },
    backupEmployee: {
      firstName: order.backupEmployee.firstName,
      lastName: order.backupEmployee.lastName,
    },
  }
}
