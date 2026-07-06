// Facade re-export tras la reorganización de Fase 0-B.
// El código real vive en lib/supabase/{client,server}.ts y lib/db/*.ts.
// Este archivo existe para no romper los ~14 imports actuales de @/lib/supabase.
// Nuevos módulos deben importar de los paths específicos, no de este facade.

export { supabase } from './supabase/client'

export type {
  UserRole,
  Organization,
  Site,
  Building,
  Room,
  Profile,
  Event,
  Device,
  SiteWithOrganization,
  BuildingWithSite,
  RoomWithBuilding,
  DeviceWithLocation,
  DashboardStats,
} from './db/types'

export {
  getCurrentUserProfile,
  isSuperAdmin,
  getUserOrganizationId,
} from './db/profiles'

export {
  getAllOrganizations,
  getUserOrganization,
  createOrganization,
} from './db/organizations'

export {
  getSitesByOrganization,
  getSiteById,
  createSite,
} from './db/sites'

export {
  getBuildingsBySite,
  createBuilding,
  updateBuilding,
  deleteBuilding,
} from './db/buildings'

export {
  getRoomsByBuilding,
  createRoom,
  updateRoom,
  deleteRoom,
} from './db/rooms'

export {
  getDevicesByRoom,
  claimDeviceToRoom,
  getDeviceCountBySite,
} from './db/devices'

export { inviteUserToOrganization } from './db/invitations'
