import type { Table } from './types'

export const initialTables: Table[] = [
  {
    name: 'users',
    columns: ['id', 'name', 'tier', 'region'],
    rows: [
      { id: 1, name: 'Ada', tier: 'pro', region: 'west' },
      { id: 2, name: 'Ben', tier: 'free', region: 'east' },
      { id: 3, name: 'Chen', tier: 'pro', region: 'east' },
      { id: 4, name: 'Dina', tier: 'free', region: 'west' },
    ],
  },
  {
    name: 'listening',
    columns: ['id', 'user_id', 'artist', 'minutes'],
    rows: [
      { id: 1, user_id: 1, artist: 'Nina Simone', minutes: 55 },
      { id: 2, user_id: 1, artist: 'Talking Heads', minutes: 35 },
      { id: 3, user_id: 2, artist: 'Sade', minutes: 20 },
      { id: 4, user_id: 3, artist: 'Bowie', minutes: 75 },
      { id: 5, user_id: 4, artist: 'Bjork', minutes: 25 },
    ],
  },
  {
    name: 'employees',
    columns: ['id', 'name', 'manager_id', 'department', 'salary'],
    rows: [
      { id: 1, name: 'Priya', manager_id: null, department: 'ops', salary: 150000 },
      { id: 2, name: 'Mateo', manager_id: 1, department: 'ops', salary: 98000 },
      { id: 3, name: 'Iris', manager_id: 1, department: 'data', salary: 112000 },
      { id: 4, name: 'Noor', manager_id: 3, department: 'data', salary: 91000 },
    ],
  },
]

export const starterQuery = "SELECT u.name, u.tier FROM users AS u WHERE u.tier = 'pro' LIMIT 2"
