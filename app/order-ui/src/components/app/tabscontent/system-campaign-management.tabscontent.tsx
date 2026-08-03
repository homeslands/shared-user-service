import { useCallback, useMemo, useState } from 'react'
import moment from 'moment'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarHeart, Download } from 'lucide-react'

import { CampaignPage } from '@/app/system/campaign/page'
import { Button, Card, CardHeader, CardTitle, DataTable } from '@/components/ui'
import { useExportExcelUsers, useUsers } from '@/hooks'
import { useUserListColumns } from '@/app/system/customers/DataTable/columns'
import { Role, ROUTE } from '@/constants'
import { IUserInfo } from '@/types'

const DATE = 'YYYY-MM-DD'
const today = () => moment().format(DATE)

/**
 * Danh sách khách có SINH NHẬT trong khoảng ngày đang chọn (mặc định HÔM NAY).
 * Nằm TRONG tab Chiến dịch vì phục vụ trực tiếp campaign loại "user-birthday":
 * xem trước ai sắp nhận ưu đãi sinh nhật.
 *
 * Backend (`GET /user`, `birthdayFromDate`/`birthdayToDate`) so khớp theo NGÀY/THÁNG
 * và BỎ QUA NĂM (format dd/MM) — nên state giữ full ngày `YYYY-MM-DD` từ date picker
 * của DataTable, nhưng chỉ phần dd/MM được gửi đi.
 */
function CustomerBirthdayView() {
  const { t } = useTranslation('customer')
  const navigate = useNavigate()
  const columns = useUserListColumns()

  const [fromDate, setFromDate] = useState<string>(today)
  const [toDate, setToDate] = useState<string>(today)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)

  const fromDayMonth = moment(fromDate, DATE).format('DD/MM')
  const toDayMonth = moment(toDate, DATE).format('DD/MM')

  const handleDateChange = useCallback((startDate: string, endDate: string) => {
    setFromDate(startDate)
    setToDate(endDate)
    setPage(1)
  }, [])

  const { data, isLoading } = useUsers(
    {
      page,
      size,
      order: 'DESC',
      hasPaging: true,
      role: Role.CUSTOMER,
      birthdayFromDate: fromDayMonth,
      birthdayToDate: toDayMonth,
    },
    true,
  )

  const handlePaginationChange = useCallback(
    (pageIndex0: number, pageSize: number) => {
      if (pageSize !== size) setSize(pageSize)
      else setPage(pageIndex0 + 1)
    },
    [size],
  )

  const handleRowClick = (row: IUserInfo) => {
    navigate(`${ROUTE.STAFF_CUSTOMER_MANAGEMENT}/${row.slug}`)
  }

  // Xuất Excel danh sách khách hàng (tên, SĐT, ngày sinh) — file theo ĐÚNG khoảng
  // sinh nhật đang lọc trên bảng (dobStartDate/dobEndDate, format dd/MM như GET /user).
  const { mutate: exportUsers, isPending: isExporting } = useExportExcelUsers()
  const handleExportExcel = useCallback(() => {
    exportUsers({
      dobFilterType: 'day_month',
      role: Role.CUSTOMER,
      dobStartDate: fromDayMonth,
      dobEndDate: toDayMonth,
    })
  }, [exportUsers, fromDayMonth, toDayMonth])

  const BirthdayActionOptions = useMemo(() => {
    return function ActionOptions() {
      return (
        <Button
          variant="outline"
          onClick={handleExportExcel}
          disabled={isExporting}
        >
          <Download className="mr-2 w-4 h-4" />
          {t('customer.analytics.exportExcel')}
        </Button>
      )
    }
  }, [handleExportExcel, isExporting, t])

  return (
    <div className="grid grid-cols-1 gap-2 pb-2 h-full">
      <Card className="shadow-none">
        <CardHeader className="flex flex-row gap-2 items-center py-3">
          <CalendarHeart className="w-5 h-5 text-primary" />
          <CardTitle className="text-base">
            {fromDayMonth === toDayMonth
              ? t('customer.birthday.title', { date: fromDayMonth })
              : t('customer.birthday.titleRange', {
                  from: fromDayMonth,
                  to: toDayMonth,
                })}
          </CardTitle>
        </CardHeader>
      </Card>

      <DataTable
        columns={columns}
        data={data?.result?.items || []}
        isLoading={isLoading}
        pages={data?.result?.totalPages || 0}
        pageIndex={page - 1}
        pageSize={size}
        onPaginationChange={handlePaginationChange}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        hiddenDatePicker={false}
        onDateChange={handleDateChange}
        actionOptions={BirthdayActionOptions}
        onRowClick={handleRowClick}
      />
    </div>
  )
}

export function SystemCampaignManagementTabsContent() {
  const { t } = useTranslation('customer')
  const { t: tCampaign } = useTranslation('campaign')
  const [view, setView] = useState<'campaign' | 'birthday'>('campaign')

  const segButton = (value: 'campaign' | 'birthday', label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setView(value)}
      className={
        'px-3 h-full text-xs font-medium rounded transition-colors ' +
        (view === value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground')
      }
    >
      {label}
    </button>
  )

  return (
    <div className="grid grid-cols-1 gap-2 pb-2 h-full">
      <Card className="shadow-none">
        <CardHeader className="flex flex-row justify-between items-center py-3">
          <CardTitle className="text-base">{tCampaign('campaign.title')}</CardTitle>
          <div className="inline-flex p-1 h-9 rounded-md border border-input bg-background">
            {segButton('campaign', tCampaign('campaign.title'))}
            {segButton('birthday', t('customer.birthday.tabTitle'))}
          </div>
        </CardHeader>
      </Card>

      {view === 'campaign' ? <CampaignPage /> : <CustomerBirthdayView />}
    </div>
  )
}
