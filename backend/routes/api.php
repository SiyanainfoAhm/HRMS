<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CompanyController;
use App\Http\Controllers\Api\V1\DepartmentController;
use App\Http\Controllers\Api\V1\DesignationController;
use App\Http\Controllers\Api\V1\DivisionController;
use App\Http\Controllers\Api\V1\EmployeeController;
use App\Http\Controllers\Api\V1\PayrollController;
use App\Http\Controllers\Api\V1\PayrollMasterController;
use App\Http\Controllers\Api\V1\PayslipController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\UserController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {

    // ── Auth (public) ───────────────────────────────────────────
    Route::prefix('auth')->group(function () {
        Route::post('login', [AuthController::class, 'login']);
        Route::post('signup', [AuthController::class, 'signup']);
        Route::post('google', [AuthController::class, 'google']);
    });

    // ── Authenticated routes ────────────────────────────────────
    Route::middleware(['auth:sanctum', 'hrms.session'])->group(function () {

        // Auth
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/change-password', [AuthController::class, 'changePassword']);

        // Current user profile
        Route::get('me', [UserController::class, 'me']);
        Route::put('me', [UserController::class, 'updateMe']);
        Route::get('me/payroll-master', [UserController::class, 'myPayrollMaster']);

        // Users (admin+)
        Route::get('users', [UserController::class, 'index']);
        Route::get('users/{id}', [UserController::class, 'show']);
        Route::put('users/{id}', [UserController::class, 'update']);

        // Employees (payroll master support)
        Route::get('employees', [EmployeeController::class, 'index']);
        Route::post('employees', [EmployeeController::class, 'store']);
        Route::get('employees/{id}', [EmployeeController::class, 'show']);
        Route::put('employees/{id}', [EmployeeController::class, 'update']);

        // Company
        Route::get('company/me', [CompanyController::class, 'me']);
        Route::post('company/setup', [CompanyController::class, 'setup']);
        Route::put('company/me', [CompanyController::class, 'updateMe']);
        Route::post('company/logo', [CompanyController::class, 'uploadLogo']);

        // Settings: Divisions
        Route::get('settings/divisions', [DivisionController::class, 'index']);
        Route::post('settings/divisions', [DivisionController::class, 'store']);
        Route::put('settings/divisions/{id}', [DivisionController::class, 'update']);
        Route::delete('settings/divisions/{id}', [DivisionController::class, 'destroy']);

        // Settings: Departments
        Route::get('settings/departments', [DepartmentController::class, 'index']);
        Route::post('settings/departments', [DepartmentController::class, 'store']);
        Route::put('settings/departments/{id}', [DepartmentController::class, 'update']);
        Route::delete('settings/departments/{id}', [DepartmentController::class, 'destroy']);

        // Settings: Designations
        Route::get('settings/designations', [DesignationController::class, 'index']);
        Route::post('settings/designations', [DesignationController::class, 'store']);
        Route::put('settings/designations/{id}', [DesignationController::class, 'update']);
        Route::delete('settings/designations/{id}', [DesignationController::class, 'destroy']);

        // Settings: Roles
        Route::get('settings/roles', [RoleController::class, 'index']);
        Route::post('settings/roles', [RoleController::class, 'store']);
        Route::put('settings/roles/{id}', [RoleController::class, 'update']);
        Route::delete('settings/roles/{id}', [RoleController::class, 'destroy']);

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
        Route::get('payroll/master/{id}', [PayrollMasterController::class, 'show']);
        Route::put('payroll/master/{id}', [PayrollMasterController::class, 'update']);
        Route::get('payroll/master', [PayrollMasterController::class, 'index']);
        Route::post('payroll/master', [PayrollMasterController::class, 'store']);
        Route::patch('payroll/master', [PayrollController::class, 'upsertMaster']);
        Route::get('payroll/run', [PayrollController::class, 'runPreview']);
        Route::post('payroll/run', [PayrollController::class, 'run']);
        Route::post('payroll/payslips', [PayrollController::class, 'storePayslips']);
        Route::get('payroll/export', [PayrollController::class, 'export']);

        // Payslips
        Route::get('payslips/me', [PayslipController::class, 'me']);
        Route::get('payslips/employee', [PayslipController::class, 'forEmployee']);
    });
});
