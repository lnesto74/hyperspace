export function legacyRoleForType(type: string): 'merchandiser' | 'cashier' {
  return type === 'staff_misallocation' ? 'cashier' : 'merchandiser'
}

export { LEVER_BY_ID } from '../profitRadar/recoveryModel'
