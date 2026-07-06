<?php

namespace App\Services;

use App\Models\HrmsCompany;
use App\Models\HrmsUser;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

/**
 * Resolves the single fixed CIRT organization for this deployment.
 * company_id remains on rows for FK safety; the app never exposes multi-company flows.
 */
final class DefaultCompanyService
{
    private const CACHE_KEY = 'cirt.default_company_id';

    public function getDefaultCompany(): HrmsCompany
    {
        $code = (string) config('app.default_company_code', 'CIRT');
        $name = (string) config('app.organization_name', 'CIRT');

        $company = HrmsCompany::query()
            ->whereRaw('LOWER(code) = ?', [mb_strtolower($code)])
            ->orderBy('created_at')
            ->first();

        if (! $company) {
            $company = HrmsCompany::query()
                ->whereRaw('LOWER(name) = ?', [mb_strtolower($name)])
                ->orderBy('created_at')
                ->first();
        }

        if (! $company) {
            $attributes = [
                'name' => $name,
                'code' => $code,
            ];
            if (Schema::hasColumn('cirt_institute', 'status')) {
                $attributes['status'] = 'active';
            }
            $company = HrmsCompany::create($attributes);
            $this->forgetCachedId();
        }

        return $company;
    }

    public function getDefaultCompanyId(): string
    {
        $cached = Cache::get(self::CACHE_KEY);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $id = (string) $this->getDefaultCompany()->id;
        Cache::forever(self::CACHE_KEY, $id);

        return $id;
    }

    public function ensureUserOnDefaultCompany(HrmsUser $user): void
    {
        $defaultId = $this->getDefaultCompanyId();
        if ($user->company_id !== $defaultId) {
            $user->forceFill(['company_id' => $defaultId])->saveQuietly();
        }
    }

    public function forgetCachedId(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * @param  list<string>  $tables
     */
    public function backfillCompanyIdOnTables(array $tables, string $companyId): void
    {
        foreach ($tables as $table) {
            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'company_id')) {
                continue;
            }

            \Illuminate\Support\Facades\DB::table($table)
                ->where(function ($query) use ($companyId) {
                    $query->whereNull('company_id')
                        ->orWhere('company_id', '!=', $companyId);
                })
                ->update(['company_id' => $companyId]);
        }
    }

    /**
     * @return list<string>
     */
    public static function companyLinkedTables(): array
    {
        return [
            'cirt_users',
            'cirt_roles',
            'cirt_employees',
            'cirt_departments',
            'cirt_designations',
            'cirt_divisions',
            'cirt_employee_bank_accounts',
            'cirt_payroll_master',
            'cirt_payroll_master_history',
            'cirt_payroll_periods',
            'cirt_monthly_payroll',
            'cirt_payslips',
            'cirt_payroll_calculation_settings',
            'cirt_payroll_field_definitions',
            'cirt_payroll_field_values',
            'cirt_salary_increments',
            'cirt_quarters',
            'cirt_quarter_assignments',
            'cirt_da_revision_events',
            'cirt_payroll_arrear_batches',
            'cirt_payroll_arrear_lines',
        ];
    }
}
