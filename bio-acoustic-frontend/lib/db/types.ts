export type UserRole = 'super_admin' | 'org_admin' | 'site_manager' | 'viewer'

export interface Organization {
  id: string
  name: string
  slug: string
  subscription_plan: 'Enterprise' | 'Pro' | 'Basic'
  subscription_status: 'active' | 'trial' | 'suspended'
  billing_email: string | null
  created_at: string
  updated_at: string
}

export interface Site {
  id: string
  organization_id: string
  name: string
  location: string | null
  address: string | null
  created_at: string
  updated_at: string
}

export interface Building {
  id: string
  site_id: string
  name: string
  building_type: string | null
  capacity: number | null
  created_at: string
  updated_at: string
}

export interface Room {
  id: string
  building_id: string
  name: string
  room_type: string | null
  capacity: number | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  organization_id: string | null
  assigned_site_id: string | null
  role: UserRole
  full_name: string | null
  email: string | null
  created_at: string
  updated_at: string
}

export interface Event {
  id: string
  created_at: string
  device_id: string
  room_id: string | null
  event_type: string
  rms_level: number
  battery_percentage: number | null
  audio_url: string | null
}

export interface Device {
  id: string
  device_id: string
  uid?: string
  mac_address?: string
  room_id: string | null
  name: string | null
  status: 'online' | 'offline' | 'maintenance'
  last_heartbeat: string | null
  firmware_version: string | null
  created_at: string
  updated_at: string
}

export interface SiteWithOrganization extends Site {
  organization: Organization
}

export interface BuildingWithSite extends Building {
  site: SiteWithOrganization
}

export interface RoomWithBuilding extends Room {
  building: BuildingWithSite
}

export interface DeviceWithLocation extends Device {
  room: RoomWithBuilding | null
}

export interface DashboardStats {
  totalAlertsToday: number
  lastAlert: Event | null
  averageNoiseLevel: number
  deviceStatus: {
    [key: string]: 'online' | 'offline'
  }
}
