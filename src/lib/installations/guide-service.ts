import type { InstallationOrderViewer } from './access'
import type { InstallationGuide } from './guide-catalog'
import { findInstallationGuide, INSTALLATION_GUIDES } from './guide-catalog'

function canInstallerReadGuides(viewer: InstallationOrderViewer): boolean {
  return viewer.role === 'INSTALLER' && Boolean(viewer.employeeId) && viewer.employeeActive === true
}

export function canViewInstallationGuide(
  guide: InstallationGuide,
  viewer: InstallationOrderViewer,
): boolean {
  if (viewer.role === 'ADMIN') return true
  if (viewer.role === 'INSTALLER') return canInstallerReadGuides(viewer) && guide.audience === 'INSTALLER'
  if (viewer.role === 'MANAGER') return guide.audience !== 'ADMIN'
  if (viewer.role === 'EMPLOYEE') return viewer.employeeActive === true && guide.audience !== 'ADMIN'
  return false
}

export function listInstallationGuidesForViewer(viewer: InstallationOrderViewer): InstallationGuide[] {
  return INSTALLATION_GUIDES.filter((guide) => canViewInstallationGuide(guide, viewer))
}

export function getInstallationGuideForViewer(
  slug: string,
  viewer: InstallationOrderViewer,
): InstallationGuide | null {
  const guide = findInstallationGuide(slug)
  return guide && canViewInstallationGuide(guide, viewer) ? guide : null
}
