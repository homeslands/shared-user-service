import { EntityManager, Repository } from 'typeorm';
import { User } from 'src/user/user.entity';

// Step 6.13 dropped the branch relation from shared-user's User: a branch is
// the business of the order services, which keep their own users by
// sharedUserId. user_tbl.branch_id_column is still there, and the modules of
// the monolith copy that still filter staff by branch (notification, printer,
// qr-payment) read it directly until they are removed in step 6.17.

// Users holding one of the roles in the branch. Same as the find() it
// replaces: an undefined branch id adds no branch condition.
export const findUsersOfBranch = async (
  users: Repository<User>,
  roleNames: string[],
  branchId: string | undefined,
): Promise<User[]> => {
  const query = users
    .createQueryBuilder('u')
    .innerJoin('u.role', 'r')
    .where('r.name_column IN (:...roleNames)', { roleNames });
  if (branchId !== undefined) {
    query.andWhere('u.branch_id_column = :branchId', { branchId });
  }
  return query.getMany();
};

export const branchIdOfUser = async (
  manager: EntityManager,
  userId: string,
): Promise<string | null> => {
  const [row] = await manager.query(
    'SELECT branch_id_column AS branchId FROM user_tbl WHERE id_column = ?',
    [userId],
  );
  return row?.branchId ?? null;
};
