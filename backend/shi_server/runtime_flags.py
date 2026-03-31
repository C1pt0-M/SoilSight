from __future__ import annotations 
 
import os 
 
def competition_mode_enabled(raw=None): 
    value = raw if raw is not None else os.getenv('SOILSIGHT_COMPETITION_MODE') 
    if value is None: 
        return True 
    token = str(value).strip().lower() 
    if not token: 
        return True 
    return token not in {'0', 'false', 'no', 'off'}
