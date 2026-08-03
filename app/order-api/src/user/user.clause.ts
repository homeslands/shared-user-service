type AccountRevenueClauseOptions = {
  hasStartDate: boolean;
  hasEndDate: boolean;
  onlyNewCustomers: boolean;
  hasPaymentMethod: boolean;
  hasPhonenumber: boolean;
};

const accountRevenueFromWhereClause = (
  options: AccountRevenueClauseOptions,
) => `
    FROM
        order_db.order_tbl AS o
    INNER JOIN
        order_db.payment_tbl AS p ON o.payment_column = p.id_column
    INNER JOIN
        order_db.user_tbl AS u ON o.owner_column = u.id_column
    INNER JOIN
        order_db.role_tbl AS r ON u.role_column = r.id_column
    LEFT JOIN
        order_db.user_tbl AS au ON o.approval_by_column = au.id_column
    LEFT JOIN
        order_db.role_tbl AS ar ON au.role_column = ar.id_column
    WHERE
        o.branch_column = ?
    AND
        p.status_code_column = 'completed'
    AND
        o.deleted_at_column IS NULL
    -- Only orders owned by customers with a registered account
    AND
        r.name_column = 'CUSTOMER'
    AND
        u.phonenumber_column != 'default-customer'
    -- Exclude transactions created by cashiers
    AND
        (o.approval_by_column IS NULL OR ar.name_column != 'CASHIER')
    ${
      options.hasStartDate
        ? `AND
        o.created_at_column >= ?`
        : ''
    }
    ${
      options.hasEndDate
        ? `AND
        o.created_at_column <= ?`
        : ''
    }
    ${
      options.onlyNewCustomers && options.hasStartDate
        ? `-- Only customers who registered within the requested date range
    AND
        u.created_at_column >= ?`
        : ''
    }
    ${
      options.onlyNewCustomers && options.hasEndDate
        ? `AND
        u.created_at_column <= ?`
        : ''
    }
    ${
      options.hasPaymentMethod
        ? `AND
        p.payment_method_column = ?`
        : ''
    }
    ${
      options.hasPhonenumber
        ? `AND
        u.phonenumber_column LIKE ?`
        : ''
    }
`;

const accountRevenuePaymentMethodSums = `
        -- Total amount for point
        SUM(CASE WHEN p.payment_method_column = 'point' THEN p.amount_column ELSE 0 END) AS totalAmountPoint,
        -- Total amount for bank
        SUM(CASE WHEN p.payment_method_column = 'bank-transfer' THEN p.amount_column ELSE 0 END) AS totalAmountBank,
        -- Total amount for cash
        SUM(CASE WHEN p.payment_method_column = 'cash' THEN p.amount_column ELSE 0 END) AS totalAmountCash,
        -- Total amount for credit card
        SUM(CASE WHEN p.payment_method_column = 'credit-card' THEN p.amount_column ELSE 0 END) AS totalAmountCreditCard`;

const accountRevenuePaymentMethodCounts = `
        -- Order count for point
        COUNT(DISTINCT CASE WHEN p.payment_method_column = 'point' THEN o.id_column END) AS countPoint,
        -- Order count for bank
        COUNT(DISTINCT CASE WHEN p.payment_method_column = 'bank-transfer' THEN o.id_column END) AS countBank,
        -- Order count for cash
        COUNT(DISTINCT CASE WHEN p.payment_method_column = 'cash' THEN o.id_column END) AS countCash,
        -- Order count for credit card
        COUNT(DISTINCT CASE WHEN p.payment_method_column = 'credit-card' THEN o.id_column END) AS countCreditCard`;

// Bucket start of the order created time, formatted like /user/statistics
const accountRevenueTimeExpr = (groupBy: string) => {
  const col = 'o.created_at_column';
  switch (groupBy) {
    case 'hour':
      return `DATE_FORMAT(${col}, '%Y-%m-%dT%H:00:00')`;
    case 'week':
      return `DATE_FORMAT(DATE_SUB(${col}, INTERVAL WEEKDAY(${col}) DAY), '%Y-%m-%dT00:00:00')`;
    case 'month':
      return `DATE_FORMAT(${col}, '%Y-%m-01T00:00:00')`;
    case 'year':
      return `DATE_FORMAT(${col}, '%Y-01-01T00:00:00')`;
    default:
      return `DATE_FORMAT(${col}, '%Y-%m-%dT00:00:00')`;
  }
};

export const getAccountRevenueStatisticClause = (
  options: AccountRevenueClauseOptions & { groupBy: string },
) => `
    SELECT
        ${accountRevenueTimeExpr(options.groupBy)} AS time,
        COUNT(DISTINCT o.id_column) AS count,${accountRevenuePaymentMethodCounts},
        SUM(p.amount_column) AS totalAmount,${accountRevenuePaymentMethodSums}
    ${accountRevenueFromWhereClause(options)}
    GROUP BY
        time
    ORDER BY
        time ASC
`;

export const getAccountRevenueClause = (
  options: AccountRevenueClauseOptions,
) => `
    SELECT
        u.slug_column AS customerSlug,
        TRIM(CONCAT(COALESCE(u.first_name_column, ''), ' ', COALESCE(u.last_name_column, ''))) AS customerName,
        u.created_at_column AS customerRegisteredAt,
        SUM(p.amount_column) AS totalAmount,${accountRevenuePaymentMethodSums}
    ${accountRevenueFromWhereClause(options)}
    GROUP BY
        u.id_column
    ORDER BY
        totalAmount DESC
`;
