import type { Building, Device, Room } from "@/lib/supabase";

export interface RoomWithDevices extends Room {
  devices: Device[];
}

export interface BuildingWithRooms extends Building {
  rooms: RoomWithDevices[];
}
