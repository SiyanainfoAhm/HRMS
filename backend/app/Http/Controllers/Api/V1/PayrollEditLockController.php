<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\PayrollEditLockService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class PayrollEditLockController extends Controller
{
    public function __construct(private readonly PayrollEditLockService $locks) {}

    public function acquire(Request $request): JsonResponse
    {
        $data = $request->validate(['year'=>['required','integer','min:2000','max:2100'],'month'=>['required','integer','min:1','max:12'],'client_id'=>['required','uuid'],'takeover'=>['sometimes','boolean']]);
        $result = $this->locks->acquire((string)$request->user()->company_id,(string)$request->user()->id,$data['client_id'],(int)$data['year'],(int)$data['month'],(bool)($data['takeover']??false));
        return response()->json($result, $result['acquired'] ? 200 : 423);
    }

    public function heartbeat(Request $request): JsonResponse
    {
        $data = $request->validate(['year'=>['required','integer','min:2000','max:2100'],'month'=>['required','integer','min:1','max:12'],'client_id'=>['required','uuid'],'lease_token'=>['required','uuid']]);
        $result = $this->locks->heartbeat((string)$request->user()->company_id,(string)$request->user()->id,$data['client_id'],$data['lease_token'],(int)$data['year'],(int)$data['month']);
        return $result ? response()->json(['active'=>true]+$result) : response()->json(['active'=>false,'message'=>'Editing lease expired or was taken over.'],423);
    }

    public function release(Request $request): JsonResponse
    {
        $data = $request->validate(['year'=>['required','integer','min:2000','max:2100'],'month'=>['required','integer','min:1','max:12'],'client_id'=>['required','uuid'],'lease_token'=>['required','uuid']]);
        $this->locks->release((string)$request->user()->company_id,(string)$request->user()->id,$data['client_id'],$data['lease_token'],(int)$data['year'],(int)$data['month']);
        return response()->json(['released'=>true]);
    }
}
