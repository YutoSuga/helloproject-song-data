import { RepositoryError } from './persistence.js';
export function applyPlanPath(id){
  if(typeof id!=='string'||!/^ap_[0-9a-f]{64}$/.test(id))throw new RepositoryError('PATH_UNSAFE','Invalid Apply Plan identity');
  return `staging/apply-plans/${id}.json`;
}
