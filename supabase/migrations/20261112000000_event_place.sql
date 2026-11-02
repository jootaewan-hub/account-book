-- 일정의 장소(D-041). 장소 이름·주소와 좌표(WGS84)를 두어, 달력에서 장소를 누르면 네이버 지도 길찾기를 바로 연다.
-- 좌표는 지도 서비스(카카오 로컬)가 준 값만 넣는다(모델이 만든 숫자를 넣지 않는다). 좌표가 없으면 앱은 네이버 지도 검색을 연다.
-- 표 권한은 표 단위(20261015150000_events)라 새 칸에 따로 grant할 것이 없다.
alter table public.events
  add column place text check (char_length(place) <= 60),
  add column address text check (char_length(address) <= 120),
  add column lat double precision,
  add column lng double precision,
  -- 둘 다 없거나, 둘 다 한국 안쪽(대략). 한쪽만 null이면 비교가 null이 되어 검사를 통과하므로 null 여부를 먼저 맞춘다
  add constraint events_coords_check check (
    (lat is null) = (lng is null)
    and (lat is null or (lat between 33 and 39 and lng between 124 and 132))
  );
