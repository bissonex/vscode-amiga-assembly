
**NAME**

AndRegionRegion -- Perform 2d AND operation of one region
with second region, leaving result in second region.

**SYNOPSIS**

```c
    status = AndRegionRegion(region1,region2)
      d0                       a0      a1

    BOOL AndRegionRegion(struct Region *, struct Region * );

```
Links: [Region](_OOBW) [Region](_OOBW) 

**FUNCTION**

Remove any portion of region2 that is not in region1.

**INPUTS**

region1 - pointer to [Region](_OOBW) structure
region2 - pointer to [Region](_OOBW) structure to use and for result

**RESULTS**

status - return TRUE if successful operation
return FALSE if ran out of memory

BUGS

**SEE ALSO**

[OrRegionRegion](OrRegionRegion) [AndRectRegion](AndRectRegion) [graphics/regions.h](_OOBW)