<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CompanyController;
use App\Http\Controllers\Api\V1\DepartmentController;
use App\Http\Controllers\Api\V1\DesignationController;
use App\Http\Controllers\Api\V1\DivisionController;
use App\Http\Controllers\Api\V1\EmployeeController;
use App\Http\Controllers\Api\V1\PayrollController;
use App\Http\Controllers\Api\V1\PayrollFieldController;
use App\Http\Controllers\Api\V1\PayrollMasterController;
use App\Http\Controllers\Api\V1\PayslipController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\QuarterController;
use App\Http\Controllers\Api\V1\SalaryIncrementController;
use App\Http\Controllers\Api\V1\UserController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {

    // ── Auth (public) ───────────────────────────────────────────
    Route::prefix('auth')->group(function () {
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
        Route::post('signup', [AuthController::class, 'signup'])->middleware('throttle:login');
        Route::post('google', [AuthController::class, 'google'])->middleware('throttle:login');
    });

    // ── Authenticated routes ────────────────────────────────────
    Route::middleware(['auth:sanctum', 'hrms.session', 'cirt.company'])->group(function () {

        // Auth
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/change-password', [AuthController::class, 'changePassword']);

        // Current user profile
        Route::get('me', [UserController::class, 'me']);
        Route::put('me', [UserController::class, 'updateMe']);
        Route::get('me/payroll-master', [UserController::class, 'myPayrollMaster']);
        Route::get('me/profile-summary', [UserController::class, 'myProfileSummary']);

        // Company (read for all authenticated users)
        Route::get('company/me', [CompanyController::class, 'me']);

        // Payslips (employee self-service)
        Route::get('payslips/me', [PayslipController::class, 'me']);
        Route::get('me/payroll-history', [PayslipController::class, 'myPayrollHistory']);
        Route::get('me/latest-payroll', [PayslipController::class, 'myLatestPayroll']);
        Route::get('me/payslip', [PayslipController::class, 'myPayslipByPeriod']);

        // Employee self lookup (controller enforces company + self/managerial)
        Route::get('employees/{id}', [EmployeeController::class, 'show']);

        // Settings lookups (read-only, company-scoped)
        Route::get('settings/divisions', [DivisionController::class, 'index']);
        Route::get('settings/departments', [DepartmentController::class, 'index']);
        Route::get('settings/designations', [DesignationController::class, 'index']);
        Route::get('settings/roles', [RoleController::class, 'index']);

        // ── Managerial / admin routes ───────────────────────────
        Route::middleware('managerial')->group(function () {

            // Users (admin+)
            Route::get('users', [UserController::class, 'index']);
            Route::get('users/{id}', [UserController::class, 'show']);
            Route::put('users/{id}', [UserController::class, 'update']);

            // Employees
            Route::get('employees', [EmployeeController::class, 'index']);
            Route::post('employees', [EmployeeController::class, 'store']);
            Route::put('employees/{id}', [EmployeeController::class, 'update']);

            // Company setup / updates
            Route::post('company/setup', [CompanyController::class, 'setup']);
            Route::put('company/me', [CompanyController::class, 'updateMe']);
            Route::post('company/logo', [CompanyController::class, 'uploadLogo']);

            // Settings: Divisions
            Route::post('settings/divisions', [DivisionController::class, 'store']);
            Route::put('settings/divisions/{id}', [DivisionController::class, 'update']);
            Route::delete('settings/divisions/{id}', [DivisionController::class, 'destroy']);

            // Settings: Departments
            Route::post('settings/departments', [DepartmentController::class, 'store']);
            Route::put('settings/departments/{id}', [DepartmentController::class, 'update']);
            Route::delete('settings/departments/{id}', [DepartmentController::class, 'destroy']);

            // Settings: Designations
            Route::post('settings/designations', [DesignationController::class, 'store']);
            Route::put('settings/designations/{id}', [DesignationController::class, 'update']);
            Route::delete('settings/designations/{id}', [DesignationController::class, 'destroy']);

            // Settings: Roles
            Route::post('settings/roles', [RoleController::class, 'store']);
            Route::put('settings/roles/{id}', [RoleController::class, 'update']);
            Route::delete('settings/roles/{id}', [RoleController::class, 'destroy']);

            // Settings: Salary increment
            Route::get('settings/salary-increment/defaults', [SalaryIncrementController::class, 'defaults']);
            Route::get('settings/salary-increment/eligible', [SalaryIncrementController::class, 'eligible']);
            Route::get('settings/salary-increment/history', [SalaryIncrementController::class, 'history']);
            Route::post('settings/salary-increment/apply', [SalaryIncrementController::class, 'apply']);

            // Settings: Payroll fields & CPF configuration
            Route::get('settings/payroll-config', [PayrollFieldController::class, 'config']);
            Route::get('settings/payroll-fields', [PayrollFieldController::class, 'index']);
            Route::post('settings/payroll-fields', [PayrollFieldController::class, 'store']);
            Route::put('settings/payroll-fields/{id}', [PayrollFieldController::class, 'update']);
            Route::post('settings/payroll-fields/{id}/deactivate', [PayrollFieldController::class, 'deactivate']);
            Route::delete('settings/payroll-fields/{id}', [PayrollFieldController::class, 'destroy']);
            Route::match(['GET', 'PUT'], 'settings/payroll-calculation-settings', [PayrollFieldController::class, 'calculationSettings']);

            // Settings: Government quarters / accommodation
            Route::get('settings/quarters', [QuarterController::class, 'index']);
            Route::post('settings/quarters', [QuarterController::class, 'store']);
            Route::put('settings/quarters/{id}', [QuarterController::class, 'update']);
            Route::post('settings/quarters/{id}/assign', [QuarterController::class, 'assign']);
            Route::post('settings/quarters/{id}/unassign', [QuarterController::class, 'unassign']);
            Route::post('settings/quarters/{id}/deactivate', [QuarterController::class, 'deactivate']);

            // Payroll
            Route::get('payroll/periods', [PayrollController::class, 'periods']);
            Route::post('payroll/periods', [PayrollController::class, 'storePeriod']);
            Route::put('payroll/periods/{id}', [PayrollController::class, 'updatePeriod']);
            Route::get('payroll/master/import-template', [PayrollMasterController::class, 'importTemplate']);
            Route::post('payroll/master/recalculate-all', [PayrollMasterController::class, 'recalculateAll']);
            Route::post('payroll/master/sync-existing-employees', [PayrollMasterController::class, 'syncExisting']);
            Route::post('payroll/master/import-preview', [PayrollMasterController::class, 'importPreview']);
            Route::post('payroll/master/import', [PayrollMasterController::class, 'import']);
            Route::get('payroll/master/export', [PayrollMasterController::class, 'export']);
            Route::post('payroll/master/preview', [PayrollMasterController::class, 'preview']);
            Route::post('payroll/master/{id}/recalculate', [PayrollMasterController::class, 'recalculate']);
            Route::post('payroll/master/{id}/deactivate', [PayrollMasterController::class, 'deactivate']);
            Route::get('payroll/master/{id}/history', [PayrollMasterController::class, 'history']);
            Route::get('payroll/master/{id}/arrear-history', [PayrollMasterController::class, 'arrearHistory']);
            Route::get('payroll/master/{id}', [PayrollMasterController::class, 'show']);
            Route::put('payroll/master/{id}', [PayrollMasterController::class, 'update']);
            Route::get('payroll/master', [PayrollMasterController::class, 'index']);
            Route::post('payroll/master', [PayrollMasterController::class, 'store']);
            Route::patch('payroll/master', [PayrollController::class, 'upsertMaster']);
            Route::get('payroll/run', [PayrollController::class, 'runPreview']);
            Route::get('payroll/arrears/debug-unpaid', [PayrollController::class, 'debugUnpaidArrears']);
            Route::post('payroll/run', [PayrollController::class, 'run']);
            Route::post('payroll/payslips', [PayrollController::class, 'storePayslips']);
            Route::get('payroll/export', [PayrollController::class, 'export']);

            // Payslips (admin view for employee)
            Route::get('payslips/employee', [PayslipController::class, 'forEmployee']);
        });
    });
});
