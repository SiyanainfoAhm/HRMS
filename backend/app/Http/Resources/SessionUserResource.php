<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** Minimal user payload returned on login (matches legacy SessionUser shape). */
class SessionUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'name' => $this->name,
            'role' => $this->role?->value ?? $this->role,
            'sv' => (int) ($this->auth_session_version ?? 0),
        ];
    }
}
